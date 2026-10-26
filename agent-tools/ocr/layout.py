from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

LAYOUT_ID = "reading-order-v1"
STEMS = "甲乙丙丁戊己庚辛壬癸"
BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
STEM_SET = set(STEMS)
BRANCH_SET = set(BRANCHES)
FOOTER_RE = re.compile(r"^(?:Tel\s*:.*|\d{1,3})$", re.IGNORECASE)
STEM_TAIL_RE = re.compile(rf"^(.*?)([{STEMS}]{{2,12}})$")
BRANCH_HEAD_RE = re.compile(rf"^([{BRANCHES}]{{2,12}})(.*)$")


def geometry(polygon) -> dict:
    xs = [float(point[0]) for point in polygon]
    ys = [float(point[1]) for point in polygon]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return {
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
        "w": max(x1 - x0, 1.0),
        "h": max(y1 - y0, 1.0),
        "cx": (x0 + x1) / 2.0,
        "cy": (y0 + y1) / 2.0,
    }


def as_item(record: dict) -> dict:
    item = geometry(record["polygon"])
    item["text"] = str(record.get("text") or "")
    item["sequence"] = record.get("sequence")
    return item


def same_line(left: dict, right: dict) -> bool:
    overlap = min(left["y1"], right["y1"]) - max(left["y0"], right["y0"])
    return overlap >= 0.45 * min(left["h"], right["h"])


def cluster_lines(items: list[dict]) -> list[list[dict]]:
    ordered = sorted(items, key=lambda item: (item["cy"], item["x0"]))
    lines: list[list[dict]] = []
    used = [False] * len(ordered)
    for index, item in enumerate(ordered):
        if used[index]:
            continue
        line = [item]
        used[index] = True
        for other_index in range(index + 1, len(ordered)):
            if used[other_index]:
                continue
            if any(same_line(member, ordered[other_index]) for member in line):
                line.append(ordered[other_index])
                used[other_index] = True
        line.sort(key=lambda member: member["x0"])
        lines.append(line)
    lines.sort(key=lambda line: sum(member["cy"] for member in line) / len(line))
    return lines


def is_cjk_char(value: str) -> bool:
    return len(value) == 1 and "\u4e00" <= value <= "\u9fff"


def join_line_text(items: list[dict]) -> str:
    texts = [item["text"] for item in items if item["text"]]
    if not texts:
        return ""
    if all(is_cjk_char(text) for text in texts):
        return "".join(texts)
    joined = texts[0]
    for previous, current in zip(items, items[1:]):
        gap = current["x0"] - previous["x1"]
        char_w = previous["w"] / max(len(previous["text"]), 1)
        piece = current["text"]
        if not piece:
            continue
        if gap <= 0.7 * char_w:
            joined += piece
        else:
            joined += f" {piece}"
    return joined.strip()


def merge_vertical_singles(lines: list[str], clustered: list[list[dict]]) -> list[str]:
    merged: list[str] = []
    index = 0
    while index < len(lines):
        cluster = clustered[index]
        if len(cluster) == 1 and is_cjk_char(cluster[0]["text"]):
            column = [cluster[0]["text"]]
            anchor = cluster[0]
            look = index + 1
            while look < len(clustered):
                nxt = clustered[look]
                if len(nxt) != 1 or not is_cjk_char(nxt[0]["text"]):
                    break
                other = nxt[0]
                x_overlap = min(anchor["x1"], other["x1"]) - max(anchor["x0"], other["x0"])
                y_gap = other["y0"] - anchor["y1"]
                if x_overlap < 0.4 * min(anchor["w"], other["w"]) or y_gap > 1.4 * anchor["h"]:
                    break
                column.append(other["text"])
                anchor = other
                look += 1
            if 2 <= len(column) <= 6:
                merged.append("".join(column))
                index = look
                continue
        merged.append(lines[index])
        index += 1
    return merged


def is_stem_run(value: str) -> bool:
    return bool(value) and all(char in STEM_SET for char in value) and len(value) >= 2


def is_branch_run(value: str) -> bool:
    return bool(value) and all(char in BRANCH_SET for char in value) and len(value) >= 2


def is_pillar_run(value: str) -> bool:
    if not value or len(value) % 2:
        return False
    return all(value[index] in STEM_SET and value[index + 1] in BRANCH_SET for index in range(0, len(value), 2))


def split_stem_line(text: str) -> tuple[str, str] | None:
    match = STEM_TAIL_RE.match(text.strip())
    if not match:
        return None
    prefix, stems = match.group(1), match.group(2)
    if not is_stem_run(stems) or is_pillar_run(stems):
        return None
    return prefix, stems


def split_branch_line(text: str) -> tuple[str, str] | None:
    match = BRANCH_HEAD_RE.match(text.strip())
    if not match:
        return None
    branches, suffix = match.group(1), match.group(2)
    if not is_branch_run(branches):
        return None
    return branches, suffix.strip()


def pair_stem_branch_lines(lines: list[str]) -> list[str]:
    paired: list[str] = []
    index = 0
    while index < len(lines):
        stem_parts = split_stem_line(lines[index])
        branch_parts = split_branch_line(lines[index + 1]) if index + 1 < len(lines) else None
        if stem_parts and branch_parts and len(stem_parts[1]) == len(branch_parts[0]):
            prefix, stems = stem_parts
            branches, suffix = branch_parts
            pillars = " ".join(stems[offset] + branches[offset] for offset in range(len(stems)))
            extra = f" {suffix}" if suffix else ""
            paired.append(f"{prefix}{pillars}{extra}".strip())
            index += 2
            continue
        paired.append(lines[index])
        index += 1
    return paired


def reconstruct_page(records: list[dict]) -> list[str]:
    items = [as_item(record) for record in records if record.get("text")]
    clustered = []
    texts = []
    for line in cluster_lines(items):
        text = join_line_text(line)
        if not text:
            continue
        clustered.append(line)
        texts.append(text)
    merged = merge_vertical_singles(texts, clustered)
    paired = pair_stem_branch_lines(merged)
    return [line for line in paired if line and not FOOTER_RE.match(line)]


def relayout_jsonl(jsonl_path: Path) -> dict:
    records = [json.loads(line) for line in jsonl_path.read_text(encoding="utf-8").splitlines() if line]
    if not records or records[0].get("type") != "document":
        raise ValueError(f"not an OCR jsonl document: {jsonl_path}")
    document = records[0]
    line_records = [row for row in records if row.get("type") == "line"]
    pages: dict[int, list[dict]] = {}
    for row in line_records:
        pages.setdefault(int(row["page"]), []).append(row)
    layout_records = []
    page_texts = []
    for page_number in sorted(pages):
        texts = reconstruct_page(pages[page_number])
        for sequence, text in enumerate(texts, start=1):
            layout_records.append({"type": "layout_line", "page": page_number, "sequence": sequence, "text": text})
        page_texts.append(f"=== PAGE {page_number} ===\n" + "\n".join(texts))
    document["layoutId"] = LAYOUT_ID
    document["layoutLines"] = len(layout_records)
    text_body = "\n\f\n".join(page_texts) + ("\n" if page_texts else "")
    document["textSha256"] = hashlib.sha256(text_body.encode("utf-8")).hexdigest()
    text_path = jsonl_path.with_suffix(".txt")
    rebuilt = [document, *line_records, *layout_records]
    jsonl_path.write_text("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rebuilt), encoding="utf-8", newline="\n")
    text_path.write_text(text_body, encoding="utf-8", newline="\n")
    return {
        "jsonl": str(jsonl_path),
        "text": str(text_path),
        "pages": len(pages),
        "rawLines": len(line_records),
        "layoutLines": len(layout_records),
        "layoutId": LAYOUT_ID,
        "textSha256": document["textSha256"],
    }


def self_test() -> None:
    preface = reconstruct_page([
        {"polygon": [[680, 149], [780, 149], [780, 257], [680, 257]], "text": "前"},
        {"polygon": [[904, 148], [1003, 148], [1003, 256], [904, 256]], "text": "言"},
    ])
    assert preface == ["前言"], preface
    chart = reconstruct_page([
        {"polygon": [[277, 578], [786, 578], [786, 638], [277, 638]], "text": "乾造：丙辛丙戊"},
        {"polygon": [[405, 662], [830, 662], [830, 722], [405, 722]], "text": "戌卯午子"},
        {"polygon": [[833, 664], [1020, 664], [1020, 722], [833, 722]], "text": "(寅卯空)"},
        {"polygon": [[280, 751], [504, 751], [504, 806], [280, 806]], "text": "大运：壬辰"},
        {"polygon": [[204, 2001], [613, 1998], [614, 2046], [204, 2048]], "text": "Tel:0411—85675001"},
        {"polygon": [[779, 1999], [845, 1999], [845, 2055], [779, 2055]], "text": "33"},
    ])
    assert chart[0] == "乾造：丙戌 辛卯 丙午 戊子 (寅卯空)", chart
    assert chart[1] == "大运：壬辰", chart
    assert all("Tel" not in line and line != "33" for line in chart), chart
    title = reconstruct_page([
        {"polygon": [[526, 96], [743, 96], [743, 181], [526, 181]], "text": "第二部"},
        {"polygon": [[784, 101], [1123, 101], [1123, 177], [784, 177]], "text": "死亡命例集"},
    ])
    assert title == ["第二部死亡命例集"], title


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Reconstruct reading-order OCR text")
    result.add_argument("--self-test", action="store_true")
    result.add_argument("--jsonl")
    return result


def main() -> int:
    args = parser().parse_args()
    if args.self_test:
        self_test()
        print(json.dumps({"ok": True, "layoutId": LAYOUT_ID}, ensure_ascii=False, separators=(",", ":")))
        return 0
    if not args.jsonl:
        raise SystemExit("--jsonl is required unless --self-test is set")
    value = relayout_jsonl(Path(args.jsonl))
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
