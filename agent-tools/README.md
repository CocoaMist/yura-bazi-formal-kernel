# Agent Tools

The inspection and indexing toolkit uses Node.js built-ins without npm dependencies;
book-corpus commands require a Node.js runtime with `node:sqlite`. The optional
OCR adapter uses its separate Python/GPU runtime, documented below.
This folder is development support only: it is not imported by `src/`, does not
compile Bazi material, and carries no release or formal-state authority.

The goal is to avoid verbose PowerShell pipelines and return structured evidence
an agent can consume directly. Inspection results use deterministic ordering and
color-free output; OCR and live Agent Room execution have separate runtime dependencies.
There are no implicit scan, path, file-size, result-count or line-count limits.
Optional filters exist only when a particular task asks for a narrower view.

## Commands

Run these commands from the repository root. Dataset paths such as `data`, `books`
and `scans` are examples; replace them with the inputs being inspected.

```powershell
# File list
npm run agent:tools -- files src --ext mjs

# Literal text search (default); add --regex only when required
npm run agent:tools -- search "previousStateHash" src --ext mjs --context 2
npm run agent:tools -- find resolver src --ext mjs
npm run agent:tools -- lookup "previousStateHash" src --max 40 --related-max 16

# Read a precise line window
npm run agent:tools -- read src/state/resolver.mjs --lines 1:90

# Directory overview
npm run agent:tools -- tree src

# Extract one JSON subtree by dot path or JSON Pointer
npm run agent:tools -- json release-manifest.json releaseReport

# Large-data inventory, hashes, duplicates and JSONL validation
npm run agent:tools -- stats data
npm run agent:tools -- inventory data --hash
npm run agent:tools -- dupes data
npm run agent:tools -- jsonl data/events.jsonl --field type

# Encoding/corruption, tabular fields, JSONL schema and ZIP/EPUB inventory
npm run agent:tools -- encoding data
npm run agent:tools -- table data/records.csv
npm run agent:tools -- schema data/events.jsonl
npm run agent:tools -- archive data/book.epub

# Atomic incremental manifest; unchanged file hashes are reused on the next run
npm run agent:tools -- index data --out artifacts/indexes/data-index.jsonl

# Book corpus: lossless source identity, EPUB spine extraction and SQLite FTS
npm run agent:tools -- book-index books --db artifacts/books.sqlite
npm run agent:tools -- book-search "阴阳" --db artifacts/books.sqlite
npm run agent:tools -- book-status --db artifacts/books.sqlite
npm run agent:tools -- book-verify --db artifacts/books.sqlite
npm run agent:tools -- book-export --db artifacts/books.sqlite --out artifacts/books.jsonl

# Offline GPU OCR for scans and PDF books
npm run agent:tools -- ocr scans --out artifacts/ocr
npm run agent:tools -- ocr-relayout artifacts/ocr/book.pdf.ocr.jsonl
npm run agent:tools -- ocr-status
npm run agent:tools -- ocr-smoke --out artifacts/ocr-smoke
```

Use `--json` when another program will consume the result. Search exits with
code `1` when there are no matches, malformed input exits with code `2`, and a
successful command exits with code `0`.

## Boundaries

- This is not a shell and never executes arbitrary commands.
- Inspection commands never mutate source data.
- `index` writes only the explicitly supplied `--out` manifest using an atomic
  replacement; it never rewrites indexed files.
- `book-index` writes only the selected SQLite database. It imports TXT,
  Markdown, HTML, XHTML, XML and EPUB, removes stale rows within the selected
  source directory, and never rewrites a book. `book-export` atomically writes
  only its selected JSONL output.
- OCR writes beneath the explicitly selected output directory; `ocr-relayout`
rebuilds the text projection beside the selected OCR JSONL. Source books remain
unchanged. GPU execution is required by default, and CPU libraries stay capped
at two threads. See the OCR guide for its explicit CPU mode.
- `--max`, `--max-bytes`, `--depth`, `--columns`, `--ext` and `--ignore` are
  optional caller choices, never implicit defaults.

## Large-data implementation

Implemented now: incremental hash manifests, ZIP/EPUB inventory, encoding and
corruption audit, CSV/TSV field profiling, JSONL schema-frequency profiling,
file inventory, duplicate detection and provenance-ready SHA-256 records. The
table profiler uses a fixed-memory approximate distinct counter so row count
does not determine memory use.

The Book Corpus layer performs stable chapter-aware chunking and stores source,
extracted-text and chunk SHA-256 identities. EPUB reading follows the container,
OPF manifest and spine, with a safe HTML fallback. SQLite FTS5 trigram search
handles normal Chinese phrases; one- and two-character queries use exact
substring search. Every result contains its document path, EPUB entry, section,
normalized character range, exact chunk text and hashes. Unchanged files are
reused by size and modification time, while `book-verify` re-reads originals
and verifies source, extracted text, chunk, foreign-key and FTS consistency.
No result limit is applied unless `--max` is explicitly supplied.

The remaining next layers are cross-dataset joins, a resumable batch queue,
annotation ledgers and AST-aware symbol/call search. The deployed OCR adapter is
documented in [`ocr/README.md`](ocr/README.md).

Run its isolated tests with `npm run agent-tools:test`.

The migrated multi-agent research controller lives in
[`agent-room/`](agent-room/README.md) and runs through `npm run agent:room`.
Enable `--agent-tools` to give the room an in-process read-only kit channel.
`npm run agent:room:ui` starts the local live-view server; open the printed URL
in a browser to inspect the current room.
