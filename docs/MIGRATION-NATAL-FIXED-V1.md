# NatalFixedBundleV1 migration

YuraCore v0.6.0 changes only the default external birth-compilation projection.
`CompiledNatalArtifactV2` and `NatalCompilationBatchV2` remain intact inside the
kernel and the old external bundle remains available through
`npm run birth:compile:legacy`.

## Default output mapping

| v0.5 compatibility bundle | v0.6 fixed bundle |
| --- | --- |
| `input` | `subjectContext.birthInput`, subject, precision and traditional-sex metadata |
| `calendar.resolutionEnvelope` | `calendarResolution.resolutionEnvelope` |
| `calendar.decisionTrace.candidatePaths[]` | `calendarResolution.candidatePaths[]`, enriched with the corresponding provider resolution |
| `calendar.candidateSnapshotSet.candidates[]` | compact `pathBindings[]` with candidate, result, calendar and fixed-state references |
| every compiled result's coordinate, graph and materials | one `fixedStatesByHash[fixedStateHash]` record per distinct fixed content |
| `profileScopedStructuralCandidateSet` | `profileScopedRawRelationMatches` with only complete/partial membership |
| no reusable temporal lookup | `temporalMatchIndex.byStem`, `byBranch` and reference-only `byPillar60` |
| full candidate batch | `sourceCompilation` identity references; obtain the full batch only in legacy mode |

Calendar paths are never deduplicated. Only fixed content is deduplicated. A
compiled path has exactly one `fixedStateRef`; a failed candidate keeps its
path/result identity and has `fixedStateRef: null`. Equal fixed-state hashes do
not increase confidence and do not merge calendar provenance.

## Hash migration

`fixedStateHash` excludes `candidateId`, `candidateOrdinal`, calendar path and
subject identity. It binds the fixed state schema, coordinate/fact/material
content, deterministic-table manifest, structural and relation profiles, the
registered xun/void calculation profile and all other fixed compiler
dependencies.

`pathBindingHash` and source-projection `derivationHash` bind lineage separately.
`bundleHash` binds both the deduplicated state map and every retained path.
Every hash-bearing record declares `hashProfileId`, `hashScope` and
`hashViewSchemaVersion`.

## Temporal boundary

The fixed bundle does not expand ages, luck cycles or future dates. A caller
first resolves a concrete time to occurrence records and then invokes:

```js
matchTemporalOccurrences(fixedState, temporalOccurrences, selectedRelationProfile)
```

The result is `RawStructuralMatchSetV1`: occurrence-bound structural matches
only. Evaluation, activation, transformation, strength, priority, judgment,
effect, score and event semantics remain outside this contract.

## Compatibility

- Readers requiring the former full external envelope must request
  `--legacy-bundle-v1` or use `npm run birth:compile:legacy`.
- Readers of the new default must dispatch on
  `version === "bazi.natal_fixed_bundle.v1"`.
- Historical serialized artifacts are not relabelled. Rebuild them under the
  admitted v0.6.0 ReleaseManifest when new fixed-bundle identity is required.
