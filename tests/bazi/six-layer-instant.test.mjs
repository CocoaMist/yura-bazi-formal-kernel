import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function compileBirth(local, clockPolicies = ['civil', 'true_solar']) {
const input = JSON.parse(readFileSync(resolve(root, 'examples/2000-07-19-beijing-male.input.json'), 'utf8'));
input.birth.input.local = local;
input.clockPolicies = clockPolicies;
const run = spawnSync(process.execPath, ['tools/compile-birth.mjs'], {
cwd: root, input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 10_000_000,
});
assert.equal(run.status, 0, run.stderr);
return JSON.parse(run.stdout);
}

function compileSixLayer(payload) {
  return spawnSync(process.execPath, ['tools/compile-six-layer-instant.mjs'], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

test('named luck schedules fill all six layers for a civil instant without inventing a missing layer', () => {
  const run = compileSixLayer({
    version: 'yuracore.six_layer_instant_compile_request.v1',
    natalFixedBundlePath: 'examples/2000-07-19-beijing-male.output.json',
    local: '2030-07-19T16:00:00',
    clockPolicy: 'civil',
  });
  assert.equal(run.status, 0, run.stderr);
  const bundle = JSON.parse(run.stdout);
  assert.equal(bundle.version, 'yuracore.six_layer_instant_bundle.v1');
  assert.equal(bundle.compileTemporalRequestCalled, true);
  assert.equal(bundle.judgmentStatus, 'not_evaluated');
  assert.equal(bundle.causalStatus, 'not_modeled');
  assert.equal(bundle.effectEligible, false);
  assert.equal(bundle.direction, 'forward');
  assert.equal(bundle.competingMinorMethodsNotSelected, true);
  assert.deepEqual(
    bundle.layers.map((layer) => layer.layerId),
    ['major_luck', 'minor_luck', 'year', 'month', 'day', 'hour'],
  );
  assert.equal(bundle.layers[0].pillar, '丙戌');
  assert.equal(bundle.layers[0].subjectBound, true);
  assert.equal(bundle.layers[1].subjectBound, true);
  assert.equal(bundle.layers[2].pillar, '庚戌');
  assert.equal(bundle.layers[3].pillar, '癸未');
  assert.equal(bundle.layers[2].subjectBound, false);
  for (const pair of bundle.interTemporalPairs) {
    const leftStem = pair.left.split(':')[1][0];
    const rightStem = pair.right.split(':')[1][0];
    if (leftStem === rightStem) {
      assert.equal(
        pair.structural.some((item) => item.rule === 'stem_five_combination'),
        false,
        `same-stem pair ${pair.left} / ${pair.right} must not be reported as 五合`,
      );
    }
  }
});

test('six-layer instant adapter refuses to invent a missing clock policy or local instant', () => {
  const missingLocal = compileSixLayer({
    version: 'yuracore.six_layer_instant_compile_request.v1',
    natalFixedBundlePath: 'examples/2000-07-19-beijing-male.output.json',
    clockPolicy: 'civil',
  });
  assert.notEqual(missingLocal.status, 0);
  const error = JSON.parse(missingLocal.stderr);
  assert.equal(error.version, 'yuracore.six_layer_instant_error.v1');
  assert.equal(error.retryable, false);
});

test('six-layer projection binds civil pillars, relations and groups to the same fixed state', () => {
let selected;
// Hash order can change with an admitted release. Find a real split where
// the civil path is not first, rather than freezing a hash-order fixture.
for (const hour of ['05', '03', '01', '07', '09', '11', '13', '15', '17', '19', '21', '23']) {
const bundle = compileBirth(`2000-07-19T${hour}:00:00`);
const path = bundle.calendarResolution.candidatePaths.find((row) => row.calendarResolution.request.solarTime.mode === 'civil');
const binding = bundle.pathBindings.find((row) => row.candidateOrdinal === path.candidateOrdinal);
if (binding.fixedStateRef !== Object.keys(bundle.fixedStatesByHash).sort()[0]) {
selected = { bundle, binding };
break;
}
}
assert.ok(selected, 'fixture must exercise a civil candidate that is not hash-first');
const { bundle, binding } = selected;
const run = compileSixLayer({
version: 'yuracore.six_layer_instant_compile_request.v1',
natalFixedBundle: bundle, local: '2030-07-19T16:00:00', clockPolicy: 'civil',
});
assert.equal(run.status, 0, run.stderr);
const output = JSON.parse(run.stdout);
assert.equal(output.fixedStateRef, binding.fixedStateRef);
const pillars = bundle.fixedStatesByHash[binding.fixedStateRef].coordinates.pillars;
const opposites = { zi: 'wu', chou: 'wei', yin: 'shen', mao: 'you', chen: 'xu', si: 'hai', wu: 'zi', wei: 'chou', shen: 'yin', you: 'mao', xu: 'chen', hai: 'si' };
for (const relation of output.natalTemporalRelationRules.filter((row) => row.rule === 'branch_clash')) {
const layer = output.layers.find((row) => row.layerId === relation.temporal.split(':')[0]);
assert.equal(relation.natal.length, 1);
assert.equal(opposites[pillars[relation.natal[0].split('.')[0]].branchId], layer.branchId);
}
assert.ok(output.mixedCompleteGroups.length > 0);
for (const group of output.mixedCompleteGroups) {
group.occurrenceRefs.forEach((ref, index) => {
const natalSlot = /^pillar\.(year|month|day|hour)\.branch$/.exec(ref)?.[1];
if (natalSlot) assert.equal(group.requiredSymbols[index], pillars[natalSlot].branchId);
});
}
});

test('civil six-layer adapter rejects a solar-only natal bundle instead of changing paths', () => {
const run = compileSixLayer({
version: 'yuracore.six_layer_instant_compile_request.v1',
natalFixedBundle: compileBirth('2000-07-19T05:00:00', ['true_solar']),
local: '2030-07-19T16:00:00', clockPolicy: 'civil',
});
assert.notEqual(run.status, 0);
assert.match(JSON.parse(run.stderr).diagnostics.message, /no civil calendar path/);
});
