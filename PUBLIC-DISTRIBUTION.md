# Public code distribution

This repository is the independently testable public code distribution of
Yura Bazi-Centric Formal State Kernel v0.7.2.

## Included

- `src/`: deterministic Bazi structural kernel and candidate contracts.
- `capabilities/`: independent reference-calendar and structural capabilities.
- `schemas/`, `tools/`, `tests/`: JSON boundaries, audits and executable checks.
- `agent-tools/`: first-party inspection, indexing, optional Agent Room and OCR source.
- Fixed demonstration inputs/outputs, current architecture documents and migrations.

The kernel, capability implementations, deterministic tables and release manifest
are copied without semantic changes. Public packaging changes the README,
license, ignore rules, package metadata and check orchestration.
The frozen manifest remains the internal structural release identity; this public
packaging is not a new calibration admission or independent domain audit.
Local machine paths are removed from public documentation, and credential-shaped
test strings are replaced by short, nonfunctional test placeholders.

## Local research material is outside this distribution

The local research workspace also contains evidence stores, research-space,
deceased-person studies, experiments and a life-course atlas. Those packages and
their datasets are not shipped here. Architecture documents may describe their
boundaries as future/external components; they do not imply those packages are
available in this public checkout.

Books, purchased transcriptions, scanned material, named-person datasets, personal
birth inputs, historical model responses, provider configuration, cached indexes,
archives, logs and generated research exports are excluded.

Do not copy a private data directory into this repository to satisfy a test.
The root check has no dependency on those local research packages.

## Reproducible checks

Use Node.js 24 LTS and run `npm run check` from this directory. No npm install is
required. The check runs structure, source-boundary and contract validation,
Node-only development-tool tests, the kernel coverage gate and the capability
package's checks.

The optional OCR layout test expects the Python environment described in
`agent-tools/ocr/README.md` and is invoked separately with
`npm run ocr:layout:test`. GPU OCR and live model calls are not exercised by CI.

Full grammar and relation enumerations remain explicit release commands:
`npm run grammar:audit` and `npm run relations:audit`.

The structure gate rejects links except the narrow existing
`outputs/<one directory>/node_modules` dependency boundary. Public distribution
contains no links and no generated output directories.

## Licensing and validity

Original code is licensed under MIT. See `THIRD_PARTY_NOTICES.md` for algorithm
references and optional dependency boundaries. Private and third-party datasets
are not covered or redistributed.

Engineering tests establish invariants of the implementation. They do not prove
calendar accuracy, classical consensus, predictive usefulness, event probability
or causal effectiveness. Numeric forecasts are not provided.

## Contributions

Read `AGENTS.md`, `CORE.md` and `TIME_CORE.md` before changing semantics. Keep
candidate markers, explicit uncertainty, source/profile versions and import
boundaries intact. Include relevant checks with a change; do not introduce
private examples, credentials, model responses or source books.
