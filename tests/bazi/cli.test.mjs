import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compilationInputs, compileOne } from '../natal-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const golden = JSON.parse(readFileSync(
  new URL('../fixtures/natal-compiler-golden.json', import.meta.url),
  'utf8',
));

test('golden fixture and stdin CLI expose the same current compiler contract', () => {
  const artifact = compileOne(golden.snapshot);
  assert.deepEqual({
    pillarCode24: artifact.pillarCode24,
    index19: artifact.denseRank.index19,
    factCount: artifact.canonicalFactGraph.factCount,
    derivationCount: artifact.canonicalFactGraph.derivationCount,
    candidateCount: artifact.profileScopedStructuralCandidateSet.candidateCount,
    candidateTypes: [...new Set(
      artifact.profileScopedStructuralCandidateSet.candidates.map((row) => row.candidateType),
    )].sort(),
  }, golden.expected);

  const input = compilationInputs([{ candidateId: 'candidate:cli', snapshot: golden.snapshot }]);
  const run = spawnSync(process.execPath, ['tools/compile-natal.mjs'], {
    cwd: root,
    input: JSON.stringify({
      request: input.request,
      candidateSnapshotSet: input.candidateSet,
      calendarDecisionTrace: input.trace,
      releaseManifestPath: 'release-manifest.json',
    }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const batch = JSON.parse(run.stdout);
  assert.equal(batch.version, 'bazi.natal_compilation_batch.v2');
  assert.equal(batch.status, 'compiled');
  assert.equal(batch.results[0].artifact.pillarCode24, golden.expected.pillarCode24);
});
