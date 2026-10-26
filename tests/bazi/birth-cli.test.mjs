import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { domainHashV1 } from '../../src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('birth adapter defaults to one deduplicated fixed JSON bundle and preserves legacy mode', () => {
  const input = readFileSync(
    new URL('../../examples/2000-07-19-beijing-male.input.json', import.meta.url),
    'utf8',
  );
  const run = spawnSync(process.execPath, ['tools/compile-birth.mjs'], {
    cwd: root,
    input,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, '');
  const fixture = readFileSync(
    new URL('../../examples/2000-07-19-beijing-male.output.json', import.meta.url),
    'utf8',
  );
  assert.equal(run.stdout.trim(), fixture.trim());
  const bundle = JSON.parse(run.stdout);
  assert.equal(bundle.version, 'bazi.natal_fixed_bundle.v1');
  assert.equal(bundle.pathCount, 2);
  assert.equal(bundle.distinctFixedStateCount, 1);
  assert.deepEqual(bundle.pathBindings.map((binding) => binding.compilationStatus), ['compiled', 'compiled']);
  const state = bundle.fixedStatesByHash[Object.keys(bundle.fixedStatesByHash)[0]];
  assert.deepEqual(
    state.coordinates.pillars,
    {
      year: { stemId: 'geng', branchId: 'chen' },
      month: { stemId: 'gui', branchId: 'wei' },
      day: { stemId: 'wu', branchId: 'yin' },
      hour: { stemId: 'geng', branchId: 'shen' },
    },
  );
  const { bundleHash, ...preimage } = bundle;
  assert.equal(bundleHash, domainHashV1('bazi.natal_fixed_bundle.v1', preimage));

  const legacyRun = spawnSync(process.execPath, ['tools/compile-birth.mjs', '--legacy-bundle-v1'], {
    cwd: root,
    input,
    encoding: 'utf8',
  });
  assert.equal(legacyRun.status, 0, legacyRun.stderr);
  const legacy = JSON.parse(legacyRun.stdout);
  assert.equal(legacy.version, 'yuracore.birth_compilation_bundle.v1');
  assert.equal(legacy.calendar.candidateSnapshotSet.candidateCount, 2);
  assert.ok(Buffer.byteLength(run.stdout) < Buffer.byteLength(legacyRun.stdout));
  const { bundleHash: legacyHash, ...legacyPreimage } = legacy;
  assert.equal(legacyHash, domainHashV1('yuracore.birth_compilation_bundle.v1', legacyPreimage));

  const invalid = spawnSync(process.execPath, ['tools/compile-birth.mjs'], {
    cwd: root,
    input: '{',
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.deepEqual(JSON.parse(invalid.stderr).errorCode, 'invalid_json');

  const unsupportedArgument = spawnSync(process.execPath, ['tools/compile-birth.mjs', '--unknown'], {
    cwd: root,
    input,
    encoding: 'utf8',
  });
  assert.equal(unsupportedArgument.status, 1);
  assert.equal(JSON.parse(unsupportedArgument.stderr).errorCode, 'invalid_input_or_domain_failure');
});
