# Agent Room

This is the research Agent Room migrated from the sibling
`YuraCore/src/research/agent-room` on 2026-09-02. The six room
modules were copied, while imports of the old runtime were replaced by small
local compatibility modules under `support/`. Its original tests and CLI entry
were migrated with it.

Agent Room remains research-only. It may coordinate model roles, public web
research and a run-local file workspace, but its reports never become kernel
facts, rules, Effects or formal state. Provider credentials remain environment
variables and provider errors are redacted.

Read-only local source admission accepts the three copied corpus roots
under `library/book/` (`wikisource-mingli`, `ctext-mingli` and
`purchased-20260831`), their legacy `data/sources/` locations, and
`research-tests/deceased-persons/analysis/generated/`. The `read_file` tool
also accepts `docs/` and the run workspace. The `write_file` tool writes only
inside `artifacts/agent-room-runs/<room_id>/workspace`; controller reports,
checkpoints and progress files live under explicitly selected `artifacts/`
paths. OCR has the separate output boundary described below.

Run the commands below from the repository root.

```powershell
# Dry-run plan
npm run agent:room -- --objective "核验公开资料并保留反例" --web

# Live run; requires the selected provider credential environment variable
npm run agent:room -- --objective "核验公开资料并保留反例" --web --agent-tools --live

# Start the local live-view server, then open its printed URL in a browser
npm run agent:room:ui
```

`--agent-tools` grants `lookup`, `search_files`, `search_content` and the generic
`agent_tools` kit. `lookup` is the default repository search: exact file names,
exact snippets, plus related hits from camelCase/path tokens and same-directory
files. `index`, `book-index`, `book-export` and `ocr-smoke` stay blocked.
`--ocr` additionally grants `ocr`,
`ocr-status` and `ocr-relayout` through `agent_tools`: output must stay under
`artifacts/ocr/`, input must stay under `library/` or `artifacts/ocr/`, and GPU
is required. OCR text remains research evidence. The live UI reads
`artifacts/agent-room-runs/<room_id>/status.json` on `http://127.0.0.1:3780/`.

The repository inspection toolkit has no implicit data limits. Agent Room is a
different trust boundary: its original network, credential, research-only and
workspace-write safeguards remain intact so imported data or web pages cannot
grant themselves authority or arbitrary machine access.
