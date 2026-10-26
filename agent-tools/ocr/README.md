# Book OCR

Offline Chinese OCR for scanned books, page images and PDFs. The deployed
runtime uses RapidOCR 3.9.2, PP-OCRv6 small detection/recognition models and
ONNX Runtime GPU on the local NVIDIA card. It is development/research tooling
only and never creates kernel facts, rules or formal-state authority.

The isolated runtime is `agent-tools/ocr/.venv`. Recreate it with:

```powershell
powershell -ExecutionPolicy Bypass -File agent-tools/ocr/install.ps1
```

Run OCR recursively without an implicit file or page limit:

```powershell
npm run agent:tools -- ocr scans --out artifacts/ocr
npm run agent:tools -- ocr book.pdf --out artifacts/ocr --dpi 400
npm run agent:tools -- ocr-status
npm run agent:tools -- ocr-smoke --out artifacts/ocr-smoke
```

Each source produces an atomic `.ocr.jsonl` evidence stream and a corpus-ready
`.ocr.txt`. JSONL retains source SHA-256, rendered-page SHA-256, model identity,
page number, model sequence, polygon coordinates, confidence and verbatim text.
`.ocr.txt` is reconstructed reading-order layout: same-line boxes are joined,
stem-over-branch natal charts are paired into `丙戌 辛卯 丙午 戊子` style
pillars, and page footers are omitted from the text projection. Raw detection
lines remain in JSONL. Rebuild layout without re-running GPU OCR:

```powershell
npm run agent:tools -- ocr-relayout artifacts/ocr/book.pdf.ocr.jsonl
```
Unchanged sources are reused; `--force` explicitly rebuilds them. GPU is
required by default and a silent CPU fallback is treated as an error. Use
`--cpu` only when CPU execution is intentionally requested. All CPU libraries
and ONNX Runtime sessions are capped at two threads.
