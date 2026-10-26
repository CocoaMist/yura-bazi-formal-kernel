import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAZI_FORMAL_KERNEL_VERSION,
  COMPILED_NATAL_ARTIFACT_VERSION,
  domainHashV1,
  packFourPillars24,
  rankGrammarState19,
} from '../../src/index.mjs';
import { SAMPLE_SNAPSHOT } from '../helpers.mjs';
import { compileOne, compileSnapshots } from '../natal-fixtures.mjs';
import { assertCompiledNatalArtifact } from '../../src/bazi/kernel.mjs';

test('unified compiler emits one self-hash-free v2 artifact with all P0-P2 identities', () => {
  const artifact = compileOne(SAMPLE_SNAPSHOT);
  assert.equal(artifact.version, COMPILED_NATAL_ARTIFACT_VERSION);
  assert.equal(artifact.compilerIdentity.kernelVersion, BAZI_FORMAL_KERNEL_VERSION);
  assert.equal(artifact.pillarCode24, packFourPillars24(SAMPLE_SNAPSHOT.pillars));
  assert.equal(artifact.denseRank.index19, rankGrammarState19(SAMPLE_SNAPSHOT.pillars));
  for (const field of [
    'candidateSnapshotHash', 'coordinateHash', 'foundationDependencyHash',
    'canonicalFactGraphHash', 'structuralCandidateSetHash', 'releaseManifestHash',
    'selectedRelationProfileHash', 'provenanceRoot', 'compiledNatalArtifactHash',
  ]) assert.match(artifact[field], /^sha256:[0-9a-f]{64}$/, field);
  const { compiledNatalArtifactHash, ...body } = artifact;
  assert.equal(
    compiledNatalArtifactHash,
    domainHashV1('bazi.compiled_natal_artifact.v2', body),
  );
  assert.equal(assertCompiledNatalArtifact(artifact), artifact);
  assert.throws(() => assertCompiledNatalArtifact(null), /factory-produced/);
  assert.throws(() => assertCompiledNatalArtifact('artifact'), /factory-produced/);
  assert.throws(() => assertCompiledNatalArtifact({ ...artifact }), /factory-produced/);
});

test('traditional sex metadata changes candidate identity but not P0-P2 structure', () => {
  const male = compileOne({ ...SAMPLE_SNAPSHOT, version: 'bazi.chart_snapshot.v2', traditionalSexClass: 'male' });
  const female = compileOne({ ...SAMPLE_SNAPSHOT, version: 'bazi.chart_snapshot.v2', traditionalSexClass: 'female' });
  assert.notEqual(male.candidateSnapshotHash, female.candidateSnapshotHash);
  assert.equal(male.coordinateHash, female.coordinateHash);
  assert.equal(male.foundationDependencyHash, female.foundationDependencyHash);
  assert.equal(male.canonicalFactGraphHash, female.canonicalFactGraphHash);
  assert.equal(male.structuralCandidateSetHash, female.structuralCandidateSetHash);
});

test('candidate identity changes do not rewrite structural identity', () => {
  const batch = compileSnapshots([
    { candidateId: 'candidate:a', snapshot: SAMPLE_SNAPSHOT },
    { candidateId: 'candidate:b', snapshot: { ...SAMPLE_SNAPSHOT, snapshotId: 'snapshot:b' } },
  ]);
  const [left, right] = batch.results.map((result) => result.artifact);
  assert.notEqual(left.compiledNatalArtifactHash, right.compiledNatalArtifactHash);
  assert.equal(left.coordinateHash, right.coordinateHash);
  assert.equal(left.canonicalFactGraphHash, right.canonicalFactGraphHash);
});

test('the snapshot boundary rejects inherited and accessor data without invocation', () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'version', { enumerable: true, get() { reads += 1; return 'bazi.chart_snapshot.v2'; } });
  assert.throws(() => compileOne(accessor), /own data property/);
  assert.equal(reads, 0);

  const inherited = Object.create(SAMPLE_SNAPSHOT);
  assert.throws(() => compileOne(inherited), /plain JSON object/);
});

test('invalid chart grammar remains a candidate validation failure, not a thrown batch failure', () => {
  const invalid = {
    ...SAMPLE_SNAPSHOT,
    pillars: { ...SAMPLE_SNAPSHOT.pillars, month: { stemId: 'jia', branchId: 'yin' } },
  };
  const batch = compileSnapshots([{ snapshot: invalid }]);
  assert.equal(batch.status, 'failed');
  assert.equal(batch.results[0].status, 'validation_failed');
  assert.equal(batch.results[0].failedPhase, 'snapshot_validation');
});
