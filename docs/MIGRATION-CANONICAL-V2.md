# Canonical profile v2 and civil temporal projection

The v0.7.1 release corrects two independently reproduced defects. It introduces
no interpretation, scoring, state mutation or additional divination lane.

## Civil-path projection

The six-layer instant adapter selects the natal civil calendar path and now
finds its temporal result by `binding.fixedStateRef`. Pillars, natal-temporal
matches and mixed complete groups all use that same fixed state. Hash sorting
is output ordering only; it never chooses a calendar path. A solar-only bundle
is rejected when `clockPolicy` is `civil`.

The compact output now includes `fixedStateRef` in its identity preimage so
consumers can resolve the selected state in the supplied natal bundle. Its
version remains `yuracore.six_layer_instant_bundle.v1`; consumers should allow
this additive field. The resulting hash changes. The compact hash binds its
declared identity fields, not all display projections; it is not a validator
of arbitrary edited display output.

## Canonical encoding

The existing V1 profile record schemas and public function names remain. The
admitted concrete profile IDs become:

- `formal.canonical_json.nfc_code_unit.v2`
- `formal.sha256.domain_separated.v2`

Keys and string values are NFC-normalized. Colliding normalized keys are
rejected, rather than overwritten. Keys are serialized directly in UTF-16
code-unit order: `"10"` precedes `"2"`. The implementation must not construct a
sorted object and then pass that object to `JSON.stringify`, because JavaScript
enumerates integer-like keys numerically. Sparse arrays and accessor-backed
values are rejected by own-data capture. `__proto__` is preserved as an own
data property, without invoking the prototype setter.

This is the project's NFC profile, not a claim of RFC 8785/JCS compliance:
JCS does not normalize Unicode. The project explicitly chooses normalization.

## Existing data

The release, encoding-profile and hashing-profile identities change. All
release-dependent compilation products must be rebuilt from their original
inputs and current admitted manifest; never replace hashes inside an old
bundle or relabel it as current. Historical releases are rejected by current
profile admission. No legacy encoder is exposed through the current kernel.

The current example output is regenerated. Books, evidence, research outputs,
experiment datasets and prior run artifacts remain historical and unchanged.
The pre-repair files and their SHA-256 inventory are preserved under
`artifacts/repairs/20260908-state-binding-canonical/before/` and
`preserved-files.json`. These backups are recovery material, not a release
authority or a supported legacy runtime.

Regression tests cover a real civil/solar split whose civil state is not first
in hash order, natal branch-clash membership, mixed-group participant symbols,
solar-only rejection, nested numeric keys, Unicode normalization/collisions,
prototype-key preservation and accessor/sparse-array rejection. They are
reachable through the root `npm run check`.
