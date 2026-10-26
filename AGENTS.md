# Bazi-Centric Formal State Kernel agent entry

Read `README.md`, `PUBLIC-DISTRIBUTION.md` and `CORE.md` before editing.

This is the public code distribution. The evidence/research/library packages
mentioned below describe the wider local research architecture and are not
shipped here. Never restore private data to satisfy a check. The root public
`npm run check` validates every shipped Node package; OCR layout validation
is an optional separately configured Python check.

## Canonical paths

- `src/bazi/`: Bazi snapshot validation and lossless encoding.
- `src/bazi/foundation-profile.mjs`: versioned conventional lookup profile;
  never add weights or school judgments without an admitted profile.
- `src/bazi/structure.mjs`: raw, deterministic structural material codes.
- `src/bazi/relation-profile.mjs`: versioned raw relation codebook, six-pair
  order and complete-group definitions.
- `src/bazi/relations.mjs`: occurrence, pair, hyperedge and compact relation
 projection; it never creates state operations.
- `src/bazi/materials.mjs`: the one place that binds structural and relation
 content identity to a snapshot; the kernel and the fact graph both use it.
- `src/release/manifest.mjs`: admits the external `ReleaseManifestV2`, verifies
 deterministic table/profile hashes and creates the only compilation context.
- `src/bazi/fact-graph.mjs`: manifest-scoped deterministic facts only; it must
 stay branch-independent and exclude named relation-profile candidates.
- `src/bazi/candidates.mjs`: occurrence-bound relation-profile candidates,
 partial/complete group matches and their explicit non-activation policy.
- `src/state/`: branch keys, facts, interactions, effects, state, state sets
 and StateDelta contracts.
- `src/algebra/`: three-valued condition, evidence-status logic and the
 `EvaluationContext` that joins natal and overlay fact graphs.
- `src/causal/`: contribution, awareness and intervention contracts.
- `src/systems/`: closed Bazi lane and namespace mutation guard.
- `tests/`: executable contract and invariant tests.
- `evidence/`: four independent, one-directionally referenced evidence layers
 (`intake` buffer, `observation`, `assertion`, `pattern`). Layers are cut by
 content nature, never by source: provenance is a `sourceRefs` field, so one
 subject stays one record. An author's claim lives in `assertion` and a
 procedure-derived regularity lives in `pattern`; they must never share a store.
 `contract/evidence-layer-contract-v1.json` is the single authority and
 `tools/validate-evidence.mjs` refuses to run if any declared invariant lacks an
 implementation. It is not a kernel source directory; `src/` and `capabilities/`
 must never import it.
- `capabilities/`: independent package for calendar-provider integration,
  temporal structural evaluation and optional chart comparison. It is not a
  kernel source directory and must not import from `src/`.

## Hard boundaries

The public kernel accepts `BaziChartSnapshotV1` or `BaziChartSnapshotV2`. Never accept `BirthInput`,
calculate a chart, guess a pillar or repair an invalid snapshot.
Compilation also requires an admitted ReleaseManifest context. A coordinate
never selects or creates deterministic tables or a RelationProfile.
External snapshot/pillar DTOs must pass through the one-time own-data capture
boundary before validation or derivation. Never reintroduce a validate-then-read
path over caller objects, invoke accessors or accept inherited required fields.

Formal mutation has one path:

```text
CanonicalFactGraph -> EvaluationContext -> RuleEvaluationWitness
 -> accepted Resolution -> Mutation Admission -> Interaction -> EffectOp
 -> canonical_resolver_v3 -> StateDelta -> FormalState
```

- P1 and P2 never hand internal structures to a rule condition. Deterministic
 manifest-scoped facts go through `CanonicalFactGraph`; named relation-profile
 matches go through `ProfileScopedStructuralCandidateSet` and require an
 explicitly selected future profile.
- `EvaluationContextV4` accepts one factory-produced compiled natal artifact;
 its natal graph, candidate set, decision trace and metadata must never be
 supplied or mixed as loose cross-candidate inputs.
- Every judgment/state candidate, interaction, effect, delta and state carries
  a `branchKey`. P2 structural candidates remain branch-independent and bind
  their selected profile and concrete occurrences instead. Two evaluation
  branches never merge; a multi-school result is a `FormalStateSet`.
- The resolver requires an explicit `previousStateHash` and emits both a
 `StateDelta` and the next `FormalState`. An admitted effect that nets to zero
 or is clamped stays in the delta trace.
- A classical text reaches a rule only as
 `SourceSpan -> SourceInterpretation -> RuleDefinition`. `RuleProfile` selects
 and compiles a `RuleExecutionPlan`; it is not a product of a `SourceSpan`.
- Retrieval is read-only. It may return a `SourceSpanRef` resolved through a
 trusted corpus and may never create a span, evidence, rule, effect or state.
- A judgment is not a state change. Only a rule with a declared, registered
 `EffectTemplate` that passes Mutation Admission may propose an operation.
- An EffectTemplate belongs to one exact RuleDefinition version. Resolution
 and template references from different rule versions must never be spliced.
- Time overlays reuse the same execution plan and evaluator through an
 `EvaluationContext`. There is no second time rule engine.
- Release audit reports bind the pre-audit `candidateManifestHash`, never the
 final `releaseManifestHash`; the final hash is computed only after ordered
 audit inputs and the admission record are fixed.
- Condition verdicts are `satisfied`, `refuted` and `indeterminate`.
 `conflicted` describes disagreement between witnesses, not a failed condition.
- `indeterminate` never means `false` or zero.
- Canonical ordering is code-unit ordering. Never use `localeCompare`.
- Effect magnitude never means resulting state.
- Numeric probability or causal effect requires a complete admitted
  `CalibrationWitnessV2`; a reference string alone is insufficient.
- The public calibration-witness builder is candidate-only. Until a trusted
  non-public admission loader exists, `empirical_causal_effect` must fail
  closed and must never return `causalClaim: true`.
- Awareness and interventions create a separate decision branch; they never
  rewrite the natal snapshot or historical facts.
- Only the `bazi` lane may mutate the `bazi.*` namespace.
- No other divination system, interpretive relation engine or
  provenance-expression algebra is implemented in this repository.
- RAG, source retrieval and natural-language generation never mutate formal
  state.
- Unicode lines, trigrams and hexagrams are presentation projections only.
- `pillarCode24` is the exchange encoding. `denseRank.index19` is only a
  derived dense rank and never an input authority or snapshot identity.
- Five-element, Ten-God, hidden-stem and growth-stage codes are recomputable
  materials. They never become an Effect without an admitted rule.
- The relation layer uses exactly four visible-stem and four branch occurrence
  nodes with six fixed pillar pairs: year-month, year-day, year-hour,
  month-day, month-hour and day-hour.
- Stem five-combination matching is visible-stem-only. Never include hidden
  stems, infer a dark combination or collapse repeated occurrences by ID.
- Branch pair labels use one overlapping 5-bit mask for six harmony, clash,
  punishment, harm and break. Never force one winning label or infer priority.
- Three-harmony, three-meeting and three-member punishment structures are
  complete-only, occurrence-aware hyperedges. Presence masks are accelerators,
  never participant identity or a formal relation result.
- Raw relation materials and profile-scoped candidates are effect-ineligible. They must not contain or imply
  an Interaction, Effect, StateDelta, operation, admission, activation,
  transformed element, transformed qi or authoritative result.
- Generation is not automatically beneficial; control is not automatically
  harmful; combination is not automatically auspicious, successful or
  transformed.
- `resolveEffects` remains a candidate simulator. Effect, FormalState and
  StateDelta must retain candidate markers even when detached from its result;
  no authoritative resolver entry point exists yet.
- Do not encode useful gods, favorable/unfavorable judgments or hidden-stem
  weights as fixed bits.
- Structural profiles are named conventions, not product authority. Changing
  hidden-stem order or growth-stage starting points requires a new profile ID.
- Relation profiles are also named conventions. Half/arch/dark combinations,
  combine competition or binding, transformation, strength, useful gods and
  favorable/unfavorable judgments require separate admitted specifications.
- Relation and structural `contentHash` values identify recomputable content;
  their `materialHash` values bind that content to `snapshotHash`. Do not use
  either hash as authority or accept caller-provided derived materials.

## Scope

This repository is infrastructure. Do not add fortune interpretations, school
consensus voting, automatic useful-god derivation, interpretive relation rules,
Liuyao casting or event probabilities without separately admitted, versioned
specifications.

Test counts, module counts and short checksums belong in the `releaseReport`
section of `release-manifest.json` as a per-release snapshot. Never restate
them as architectural constants in `CORE.md`, `README.md` or a validator.
Update the manifest's `auditDigest` values whenever an audit output changes.

Evidence-layer rules that a reviewer must not relax:

- An upstream layer never references a downstream one, and `observation` never
 references `assertion`; a record of what happened must not depend on a claim.
- A `pattern` must consume at least one observation. A pattern assembled only
 from assertions restates an author's opinion as a finding.
- A `pattern` names its procedure and semantics version, declares in advance
 what would refute it and which confounds are known, and is never
 authoritative; `admissibility` is `descriptive_only` or `candidate`.
- Admission into `observation` requires at least two independent sources and a
 complete `admissionRecord`. It fails closed; material is never promoted
 because downstream work is already waiting on it.
- A detailed reading is normally authored after the outcome is known, so
 `assertion` must state `authoredAfterOutcome`, and anything not known to
 predate its outcome is barred from blind validation. Split such a reading at
 intake: chart and events to `observation`, judgment to `assertion`.

Run `npm run check` after changes. It covers kernel structure, boundaries,
contract audit, Agent Tools, kernel coverage and, through their own package
checks, `capabilities/`, `research-tests/deceased-persons/` and
`experiments/life-course-index-poc/`. A test that is not reachable from the root
check does not exist as far as review is concerned; wire new packages into it.
Run `npm run relations:audit` after relation-profile, relation-table, numeric
coordinate or pair/group changes. Run `npm run grammar:audit` after encoding or
grammar changes. The exhaustive audits are release checks, not substitutes for
targeted tests.

## Low-output repository inspection

For routine file listing, text search, bounded line reads, directory overviews
and JSON-path inspection, prefer the read-only `agent-tools/` toolkit over
verbose PowerShell pipelines. Start with `npm run agent:tools -- help`.

The toolkit is development support only. It must remain outside `src/`, must
not become a public package export or release authority, and must stay
deterministic. Inspection commands remain read-only. The explicit `index`
command may atomically replace only its caller-selected output manifest and
must never rewrite source data. Do not impose implicit scan, path, size, result
or line limits; use optional filters only when a task explicitly benefits from
a narrower view.

Book-corpus commands may write only an explicitly selected SQLite database or
JSONL export. Imported books are immutable inputs. Corpus chunks, FTS rows,
citations and hashes remain research/index evidence only and must never become
kernel facts, rules, effects, admissions or formal-state authority.

OCR commands may write only beneath an explicitly selected output directory.
They must preserve source files, retain page/polygon/hash provenance, keep the
two-thread CPU cap, and fail instead of silently falling back from requested
GPU execution. OCR text remains research evidence pending source verification.
Agent Room may run `ocr`, `ocr-status` and `ocr-relayout` only when
`capabilities.ocr` is granted; `--out` must stay under `artifacts/ocr/`, input
must stay under `library/` or `artifacts/ocr/`, and `--cpu` is refused. `index`,
`book-index`, `book-export` and `ocr-smoke` stay blocked inside the room.
