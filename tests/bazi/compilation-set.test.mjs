import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  admitReleaseManifestV2,
  canonicalJsonV1,
  compileNatalRequest,
  contentHashV1,
  domainHashV1,
  resolveSelectedRelationProfile,
} from '../../src/index.mjs';
import {
  compileNatalRequestWithHooks,
  finalizeNatalCompilationBatch,
} from '../../src/bazi/kernel.mjs';
import { RELEASE_CONTEXT } from '../helpers.mjs';
import {
  ACTIVE_PROFILE_ID,
  compilationInputs,
  compileSnapshots,
} from '../natal-fixtures.mjs';

const PILLARS = Object.freeze({
  year: Object.freeze({ stemId: 'geng', branchId: 'chen' }),
  month: Object.freeze({ stemId: 'gui', branchId: 'wei' }),
  day: Object.freeze({ stemId: 'wu', branchId: 'yin' }),
  hour: Object.freeze({ stemId: 'geng', branchId: 'shen' }),
});

function snapshot(id, pillars = PILLARS) {
  return {
    version: 'bazi.chart_snapshot.v2',
    snapshotId: id,
    subjectRef: 'subject:example',
    validTimeRef: 'time:natal',
    traditionalSexClass: 'male',
    pillars,
    provenanceRef: `calendar:${id}`,
  };
}

function resealManifest(manifest) {
  const table = structuredClone(manifest.deterministicTableManifest);
  delete table.deterministicTableManifestHash;
  manifest.deterministicTableManifest.deterministicTableManifestHash = contentHashV1(table);
  const candidatePreimage = Object.fromEntries(Object.entries(manifest).filter(([key]) => ![
    'releaseCandidate', 'auditReports', 'releaseAdmissionRecord', 'semanticIdentity',
  ].includes(key)));
  const candidateManifestHash = contentHashV1(candidatePreimage);
  manifest.releaseCandidate.candidateManifestHash = candidateManifestHash;
  for (const report of manifest.auditReports) report.candidateManifestHash = candidateManifestHash;
  manifest.releaseAdmissionRecord.candidateManifestHash = candidateManifestHash;
  manifest.releaseAdmissionRecord.auditReportHashes = manifest.auditReports.map(contentHashV1);
  delete manifest.semanticIdentity.releaseManifestHash;
  manifest.semanticIdentity.releaseManifestHash = contentHashV1(manifest);
  return manifest;
}

test('valid candidate sets total-map to compiled, validation, deterministic and internal results', () => {
  const invalidPillars = { ...PILLARS, month: { stemId: 'jia', branchId: 'wei' } };
  const inputs = compilationInputs([
    { candidateId: 'candidate:ok', snapshot: snapshot('ok') },
    { candidateId: 'candidate:invalid', snapshot: snapshot('invalid', invalidPillars) },
    { candidateId: 'candidate:compile-fail', snapshot: snapshot('compile-fail') },
    { candidateId: 'candidate:internal', snapshot: snapshot('internal') },
  ]);
  const hooks = {
    onPhase(phase, candidate) {
      if (candidate.candidateId === 'candidate:compile-fail' && phase === 'p1_fact_compilation') {
        throw new TypeError('stable table invariant failure');
      }
      if (candidate.candidateId === 'candidate:internal' && phase === 'p2_candidate_enumeration') {
        throw new Error('simulated runtime fault');
      }
    },
  };
  const batch = compileNatalRequestWithHooks(
    inputs.request,
    inputs.candidateSet,
    inputs.trace,
    inputs.releaseContext,
    hooks,
  );
  assert.equal(batch.inputCount, 4);
  assert.equal(batch.resultCount, 4);
  assert.equal(batch.status, 'partial_failure');
  assert.deepEqual(batch.results.map((result) => result.status), [
    'compiled', 'validation_failed', 'compilation_failed', 'internal_error',
  ]);
  assert.deepEqual(batch.results.map((result) => result.candidateOrdinal), [0, 1, 2, 3]);
  for (const result of batch.results.slice(1)) {
    for (const field of [
      'requestHash', 'releaseManifestHash', 'selectedRelationProfileHash',
      'failedPhase', 'stableErrorCode', 'diagnosticHash', 'retryable', 'deterministic',
    ]) assert.ok(Object.hasOwn(result, field), `missing failure field: ${field}`);
  }
  assert.equal(batch.results[1].deterministic, true);
  assert.equal(batch.results[2].deterministic, true);
  assert.equal(batch.results[3].deterministic, false);
  assert.equal(batch.results[3].retryable, true);
  assert.equal(JSON.stringify(batch.results[3].resultHash).includes('runtime fault'), false);

  const alternate = compileNatalRequestWithHooks(
    inputs.request,
    inputs.candidateSet,
    inputs.trace,
    inputs.releaseContext,
    {
      onPhase(phase, candidate) {
        if (candidate.candidateId === 'candidate:compile-fail' && phase === 'p1_fact_compilation') {
          throw new TypeError('stable table invariant failure');
        }
        if (candidate.candidateId === 'candidate:internal' && phase === 'p2_candidate_enumeration') {
          throw new Error('different host-specific diagnostic text C:\\absolute\\path');
        }
      },
    },
  );
  assert.equal(batch.results[3].resultHash, alternate.results[3].resultHash);
  assert.equal(batch.natalCompilationBatchHash, alternate.natalCompilationBatchHash);
});

test('failure taxonomy covers RangeError, non-Error faults and absent phase hooks', () => {
  const inputs = compilationInputs([
    { candidateId: 'candidate:range', snapshot: snapshot('range') },
    { candidateId: 'candidate:non-error', snapshot: snapshot('non-error') },
  ]);
  const batch = compileNatalRequestWithHooks(
    inputs.request,
    inputs.candidateSet,
    inputs.trace,
    inputs.releaseContext,
    {
      onPhase(phase, candidate) {
        if (phase !== 'coordinate_construction') return;
        if (candidate.candidateId === 'candidate:range') throw new RangeError('stable range failure');
        throw 'non-error runtime fault'; // eslint-disable-line no-throw-literal
      },
    },
  );
  assert.deepEqual(batch.results.map((result) => result.status), [
    'compilation_failed', 'internal_error',
  ]);
  assert.match(batch.results[0].stableErrorCode, /\.range$/);
  assert.equal(batch.results[1].diagnostics.errorName, 'Error');
  assert.equal(batch.results[1].diagnostics.message, 'non-error runtime fault');
  const withoutCallback = compileNatalRequestWithHooks(
    inputs.request,
    inputs.candidateSet,
    inputs.trace,
    inputs.releaseContext,
    {},
  );
  assert.equal(withoutCallback.status, 'compiled');

  const missingMessageInputs = compilationInputs([
    { candidateId: 'candidate:missing-message', snapshot: snapshot('missing-message') },
  ], { metadata: { caller: 'coverage-contract' } });
  const missingMessage = compileNatalRequestWithHooks(
    missingMessageInputs.request,
    missingMessageInputs.candidateSet,
    missingMessageInputs.trace,
    missingMessageInputs.releaseContext,
    {
      onPhase(phase) {
        if (phase === 'coordinate_construction') {
          const fault = new TypeError();
          Object.defineProperty(fault, 'message', { value: undefined });
          throw fault;
        }
      },
    },
  );
  assert.equal(missingMessage.results[0].status, 'compilation_failed');
  const metadataBatch = compileNatalRequest(
    missingMessageInputs.request,
    missingMessageInputs.candidateSet,
    missingMessageInputs.trace,
    missingMessageInputs.releaseContext,
  );
  assert.deepEqual(metadataBatch.requestMetadata, { caller: 'coverage-contract' });
});

test('zero, one and multiple successful candidates retain stable artifact-local identity', () => {
  const empty = compileSnapshots([]);
  assert.equal(empty.status, 'empty');
  assert.equal(empty.inputCount, 0);
  assert.deepEqual(empty.results, []);

  const one = compileSnapshots([{ snapshot: snapshot('one') }]);
  assert.equal(one.status, 'compiled');
  assert.equal(one.results[0].artifact.pillarCode24, 14_738_640);
  assert.equal(one.results[0].artifact.denseRank.index19, 143_456);

  const multiple = compileSnapshots([
    { candidateId: 'candidate:civil', snapshot: snapshot('civil') },
    { candidateId: 'candidate:solar', snapshot: snapshot('solar') },
  ]);
  const [civil, solar] = multiple.results.map((result) => result.artifact);
  assert.notEqual(civil.candidateSnapshotHash, solar.candidateSnapshotHash);
  assert.notEqual(civil.compiledNatalArtifactHash, solar.compiledNatalArtifactHash);
  assert.equal(civil.coordinateHash, solar.coordinateHash);
  assert.equal(civil.foundationDependencyHash, solar.foundationDependencyHash);
  assert.equal(civil.canonicalFactGraphHash, solar.canonicalFactGraphHash);
  assert.equal('calendarDecisionTrace' in civil, false);
  assert.equal(civil.candidateDecisionPathRef, 'calendar-path:0');
});

test('batch finalization is independent of execution completion order', () => {
  const input = compilationInputs([
    { candidateId: 'candidate:a', snapshot: snapshot('a') },
    { candidateId: 'candidate:b', snapshot: snapshot('b') },
  ]);
  const baseline = compileNatalRequest(input.request, input.candidateSet, input.trace, input.releaseContext);
  const selectedProfile = resolveSelectedRelationProfile(input.releaseContext, ACTIVE_PROFILE_ID);
  const reversed = finalizeNatalCompilationBatch({
    request: input.request,
    candidateSet: input.candidateSet,
    trace: input.trace,
    releaseContext: input.releaseContext,
    selectedProfile,
    results: [...baseline.results].reverse(),
  });
  assert.equal(reversed.natalCompilationBatchHash, baseline.natalCompilationBatchHash);
  assert.deepEqual(reversed.results.map((result) => result.candidateOrdinal), [0, 1]);
  assert.throws(() => finalizeNatalCompilationBatch({
    request: input.request,
    candidateSet: input.candidateSet,
    trace: input.trace,
    releaseContext: input.releaseContext,
    selectedProfile,
    results: [],
  }), /total-map cardinality/);
});

test('collection-level lifecycle errors fail the request before total-map', () => {
  const input = compilationInputs([
    { candidateId: 'candidate:a', snapshot: snapshot('a') },
    { candidateId: 'candidate:b', snapshot: snapshot('b') },
  ]);
  const compile = (candidateSet) => compileNatalRequest(
    input.request,
    candidateSet,
    input.trace,
    input.releaseContext,
  );
  const badCount = structuredClone(input.candidateSet);
  badCount.candidateCount = 1;
  assert.throws(() => compile(badCount), /candidateCount/);

  const badSnapshotHash = structuredClone(input.candidateSet);
  badSnapshotHash.candidates[0].snapshotHash = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => compile(badSnapshotHash), /snapshotHash/);

  const badSetHash = structuredClone(input.candidateSet);
  badSetHash.candidateSnapshotSetHash = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => compile(badSetHash), /candidateSnapshotSetHash/);

  const duplicate = structuredClone(input.candidateSet);
  duplicate.candidates[1].candidateId = duplicate.candidates[0].candidateId;
  const candidateBody = structuredClone(duplicate.candidates[1]);
  delete candidateBody.snapshotHash;
  duplicate.candidates[1].snapshotHash = domainHashV1('bazi.candidate_snapshot.v1', candidateBody);
  const duplicateBody = structuredClone(duplicate);
  delete duplicateBody.candidateSnapshotSetHash;
  duplicate.candidateSnapshotSetHash = domainHashV1('bazi.candidate_snapshot_set.v2', duplicateBody);
  assert.throws(() => compile(duplicate), /duplicate candidateId/);

  const wrongOrdinal = structuredClone(input.candidateSet);
  wrongOrdinal.candidates[1].candidateOrdinal = 3;
  const ordinalCandidateBody = structuredClone(wrongOrdinal.candidates[1]);
  delete ordinalCandidateBody.snapshotHash;
  wrongOrdinal.candidates[1].snapshotHash = domainHashV1('bazi.candidate_snapshot.v1', ordinalCandidateBody);
  const ordinalSetBody = structuredClone(wrongOrdinal);
  delete ordinalSetBody.candidateSnapshotSetHash;
  wrongOrdinal.candidateSnapshotSetHash = domainHashV1('bazi.candidate_snapshot_set.v2', ordinalSetBody);
  assert.throws(() => compile(wrongOrdinal), /ordinals must be unique, continuous/);
});

test('request hashes bind the exact candidate set, trace and admitted release', () => {
  const input = compilationInputs([{ snapshot: snapshot('request') }]);
  const wrong = { ...input.request, calendarDecisionTraceHash: `sha256:${'0'.repeat(64)}` };
  assert.throws(
    () => compileNatalRequest(wrong, input.candidateSet, input.trace, input.releaseContext),
    /requestHash does not match/,
  );
  assert.throws(
    () => compileNatalRequest(input.request, input.candidateSet, {
      ...input.trace, inputFactHash: `sha256:${'2'.repeat(64)}`,
    }, input.releaseContext),
    /calendarDecisionTraceHash/,
  );
});

test('release context is the only configuration authority and component drift fails closed', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../release-manifest.json', import.meta.url), 'utf8'));
  const tableVariant = structuredClone(manifest);
  tableVariant.deterministicTableManifest.schemaVersion = 'bazi.table.schema.variant';
  resealManifest(tableVariant);
  const variantContext = admitReleaseManifestV2(canonicalJsonV1(tableVariant));
  const baseline = compileSnapshots([{ snapshot: snapshot('release') }]).results[0].artifact;
  const variant = compileSnapshots([{ snapshot: snapshot('release') }], {
    releaseContext: variantContext,
  }).results[0].artifact;
  assert.notEqual(baseline.foundationDependencyHash, variant.foundationDependencyHash);
  assert.notEqual(baseline.compiledNatalArtifactHash, variant.compiledNatalArtifactHash);

  const profileDrift = structuredClone(manifest);
  profileDrift.relationProfiles.entries[0].contentHash = `sha256:${'7'.repeat(64)}`;
  resealManifest(profileDrift);
  assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(profileDrift)), /content hash mismatch/);

  const enumeratorDrift = structuredClone(manifest);
  enumeratorDrift.structuralCandidateEnumerator.enumeratorVersion = 'unadmitted.v2';
  resealManifest(enumeratorDrift);
  assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(enumeratorDrift)), /Enumerator identity/);
  assert.throws(() => compileNatalRequest({}, {}, {}, {}), /ResolvedReleaseContext/);
});
