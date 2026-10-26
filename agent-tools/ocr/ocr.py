from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Iterable

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

import cv2
import fitz
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont, ImageSequence

ort.preload_dlls(directory="")

from layout import LAYOUT_ID, reconstruct_page
from rapidocr import RapidOCR

TOOL_VERSION = "yura-book-ocr-v1"
MODEL_ID = "RapidOCR-3.9.2/PP-OCRv6-small"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
SOURCE_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(content, encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def model_files() -> list[Path]:
    package = Path(importlib.util.find_spec("rapidocr").origin).parent
    return sorted((package / "models").glob("*.onnx"), key=lambda value: value.name)


def build_engine(use_gpu: bool) -> tuple[RapidOCR, dict]:
    params = {
        "Global.log_level": "warning",
        "Global.max_side_len": 4096,
        "EngineConfig.onnxruntime.intra_op_num_threads": 2,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "EngineConfig.onnxruntime.use_cuda": use_gpu,
    }
    engine = RapidOCR(params=params)
    providers = {
        "det": engine.text_det.session.session.get_providers(),
        "cls": engine.text_cls.session.session.get_providers(),
        "rec": engine.text_rec.session.session.get_providers(),
    }
    return engine, providers


def status(use_gpu: bool = True) -> dict:
    engine, providers = build_engine(use_gpu)
    del engine
    models = [{"name": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path)} for path in model_files()]
    cuda_active = all(values and values[0] == "CUDAExecutionProvider" for values in providers.values())
    return {
        "toolVersion": TOOL_VERSION,
        "modelId": MODEL_ID,
        "rapidocr": importlib.metadata.version("rapidocr"),
        "onnxruntimeGpu": importlib.metadata.version("onnxruntime-gpu"),
        "availableProviders": ort.get_available_providers(),
        "sessionProviders": providers,
        "cudaActive": cuda_active,
        "cpuThreadLimit": 2,
        "models": models,
    }


def page_images(path: Path, dpi: int) -> Iterable[tuple[int, np.ndarray, str]]:
    if path.suffix.lower() == ".pdf":
        document = fitz.open(path)
        try:
            scale = dpi / 72.0
            matrix = fitz.Matrix(scale, scale)
            for index, page in enumerate(document):
                pixmap = page.get_pixmap(matrix=matrix, alpha=False, colorspace=fitz.csRGB)
                rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
                bgr = cv2.cvtColor(rgb[:, :, :3], cv2.COLOR_RGB2BGR)
                yield index + 1, bgr, sha256_bytes(pixmap.samples)
        finally:
            document.close()
        return

    with Image.open(path) as image:
        for index, frame in enumerate(ImageSequence.Iterator(image)):
            rgb = np.asarray(frame.convert("RGB"))
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            encoded = cv2.imencode(".png", bgr)[1].tobytes()
            yield index + 1, bgr, sha256_bytes(encoded)


def source_files(start: Path, output: Path) -> list[Path]:
    if start.is_file():
        if start.suffix.lower() not in SOURCE_EXTENSIONS:
            raise ValueError(f"unsupported OCR input: {start}")
        return [start.resolve()]
    if not start.is_dir():
        raise FileNotFoundError(start)
    output_resolved = output.resolve()
    files = []
    for path in start.rglob("*"):
        resolved = path.resolve()
        if path.is_file() and path.suffix.lower() in SOURCE_EXTENSIONS and output_resolved not in resolved.parents:
            files.append(resolved)
    return sorted(files, key=lambda value: value.as_posix())


def output_stem(source: Path, root: Path, output: Path) -> Path:
    relative = Path(source.name) if root.is_file() else source.relative_to(root.resolve())
    return output / relative.parent / f"{relative.name}.ocr"


def prior_matches(path: Path, source_sha256: str, dpi: int) -> bool:
    if not path.exists():
        return False
    try:
        first = path.open("r", encoding="utf-8").readline()
        value = json.loads(first)
        return value.get("type") == "document" and value.get("sourceSha256") == source_sha256 \
            and value.get("modelId") == MODEL_ID and value.get("dpi") == dpi and value.get("toolVersion") == TOOL_VERSION \
            and value.get("layoutId") == LAYOUT_ID
    except (OSError, ValueError):
        return False


def recognize_source(engine: RapidOCR, source: Path, root: Path, output: Path, dpi: int, force: bool) -> dict:
    source_sha256 = sha256_file(source)
    stem = output_stem(source, root, output)
    jsonl_path = Path(f"{stem}.jsonl")
    text_path = Path(f"{stem}.txt")
    if not force and prior_matches(jsonl_path, source_sha256, dpi):
        return {"source": str(source), "status": "reused", "jsonl": str(jsonl_path), "text": str(text_path)}

    document = {
        "type": "document",
        "toolVersion": TOOL_VERSION,
        "modelId": MODEL_ID,
        "source": str(source),
        "sourceSha256": source_sha256,
        "sourceBytes": source.stat().st_size,
        "dpi": dpi,
    }
    records = [document]
    layout_records = []
    page_texts = []
    total_lines = 0
    pages = 0
    for page_number, image, page_sha256 in page_images(source, dpi):
        result = engine(image, return_word_box=False)
        boxes = [] if result.boxes is None else result.boxes.tolist()
        texts = [] if result.txts is None else list(result.txts)
        scores = [] if result.scores is None else [float(value) for value in result.scores]
        page_lines = []
        for sequence, (box, text, score) in enumerate(zip(boxes, texts, scores), start=1):
            record = {
                "type": "line",
                "page": page_number,
                "sequence": sequence,
                "polygon": [[round(float(x), 3), round(float(y), 3)] for x, y in box],
                "text": text,
                "score": round(score, 8),
                "pageImageSha256": page_sha256,
            }
            records.append(record)
            page_lines.append(record)
        layout_texts = reconstruct_page(page_lines)
        for sequence, text in enumerate(layout_texts, start=1):
            layout_records.append({"type": "layout_line", "page": page_number, "sequence": sequence, "text": text})
        page_texts.append(f"=== PAGE {page_number} ===\n" + "\n".join(layout_texts))
        total_lines += len(page_lines)
        pages += 1

    document["pages"] = pages
    document["lines"] = total_lines
    document["layoutId"] = LAYOUT_ID
    document["layoutLines"] = len(layout_records)
    document["textSha256"] = sha256_bytes("\n\f\n".join(page_texts).encode("utf-8"))
    records.extend(layout_records)
    atomic_write(jsonl_path, "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in records))
    atomic_write(text_path, "\n\f\n".join(page_texts) + ("\n" if page_texts else ""))
    return {
        "source": str(source), "status": "indexed", "pages": pages, "lines": total_lines,
        "jsonl": str(jsonl_path), "text": str(text_path), "sourceSha256": source_sha256,
        "textSha256": document["textSha256"],
    }


def run_batch(args: argparse.Namespace) -> dict:
    root = Path(args.input).resolve()
    output = Path(args.output).resolve()
    files = source_files(root, output)
    engine, providers = build_engine(not args.cpu)
    cuda_active = all(values and values[0] == "CUDAExecutionProvider" for values in providers.values())
    if not args.cpu and not cuda_active:
        raise RuntimeError(f"CUDA was requested but is not active: {providers}")
    results = []
    failures = []
    for source in files:
        try:
            results.append(recognize_source(engine, source, root, output, args.dpi, args.force))
        except Exception as error:
            failures.append({"source": str(source), "error": str(error)})
    return {
        "toolVersion": TOOL_VERSION, "modelId": MODEL_ID, "input": str(root), "output": str(output),
        "files": len(files), "indexed": sum(row["status"] == "indexed" for row in results),
        "reused": sum(row["status"] == "reused" for row in results), "failed": len(failures),
        "cudaActive": cuda_active, "cpuThreadLimit": 2, "results": results, "failures": failures,
    }


def create_smoke_page(path: Path) -> None:
    image = Image.new("RGB", (1600, 1000), "#f7f1df")
    draw = ImageDraw.Draw(image)
    candidates = [Path("C:/Windows/Fonts/msyh.ttc"), Path("C:/Windows/Fonts/simsun.ttc")]
    font_path = next((candidate for candidate in candidates if candidate.exists()), None)
    if font_path is None:
        raise FileNotFoundError("a Chinese Windows font is required for the smoke test")
    title = ImageFont.truetype(str(font_path), 78)
    body = ImageFont.truetype(str(font_path), 58)
    draw.text((120, 100), "古籍文字识别部署测试", font=title, fill="#15120e")
    draw.text((120, 300), "天地玄黄，宇宙洪荒。", font=body, fill="#15120e")
    draw.text((120, 420), "阴阳变化，皆有原文可查。", font=body, fill="#15120e")
    draw.text((120, 540), "页码、坐标、哈希必须完整保存。", font=body, fill="#15120e")
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Offline GPU OCR for the Yura book corpus")
    commands = result.add_subparsers(dest="command", required=True)
    status_parser = commands.add_parser("status")
    status_parser.add_argument("--cpu", action="store_true")
    status_parser.add_argument("--require-gpu", action="store_true")
    run_parser = commands.add_parser("run")
    run_parser.add_argument("input")
    run_parser.add_argument("--output", required=True)
    run_parser.add_argument("--dpi", type=int, default=300)
    run_parser.add_argument("--cpu", action="store_true")
    run_parser.add_argument("--force", action="store_true")
    smoke_parser = commands.add_parser("smoke")
    smoke_parser.add_argument("--output", required=True)
    smoke_parser.add_argument("--cpu", action="store_true")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "status":
            value = status(not args.cpu)
            if args.require_gpu and not value["cudaActive"]:
                raise RuntimeError("CUDA execution provider is not active")
        elif args.command == "run":
            if args.dpi < 72:
                raise ValueError("--dpi must be at least 72")
            value = run_batch(args)
        else:
            output = Path(args.output).resolve()
            input_dir = output / "input"
            image = input_dir / "smoke-page.png"
            create_smoke_page(image)
            pdf = input_dir / "smoke-book.pdf"
            with Image.open(image) as source_image:
                source_image.convert("RGB").save(pdf, "PDF", resolution=300.0)
            run_args = argparse.Namespace(input=str(input_dir), output=str(output / "result"), dpi=300, cpu=args.cpu, force=True)
            value = run_batch(run_args)
        print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        return 0 if not value.get("failed") else 1
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False, separators=(",", ":")), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
