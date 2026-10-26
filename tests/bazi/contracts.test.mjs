import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALENDAR_RESOLUTION_ENVELOPE_VERSION,
  CANDIDATE_SNAPSHOT_SET_VERSION,
  CANDIDATE_SNAPSHOT_VERSION,
  NATAL_CALENDAR_DECISION_TRACE_VERSION,
  NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
  NATAL_COMPILATION_REQUEST_VERSION,
  admitReleaseManifestV2,
  assertBaziChartSnapshot,
  buildCalendarResolutionEnvelopeV1,
  buildCandidateSnapshotSetV2,
  buildCandidateSnapshotV1,
  buildNatalCalendarDecisionTraceV1,
  buildNatalCompilationRequestV1,
  canonicalJsonV1,
  compileNatalRequest,
  contentHashV1,
  domainHashV1,
  freezeBaziChartSnapshot,
  freezeBaziChartSnapshotFromCanonicalJson,
  resolveSelectedRelationProfile,
} from '../../src/index.mjs';
import {
  canonicalResultOrder,
  captureCandidateSnapshotSetV2,
  captureNatalCalendarDecisionTraceV1,
  captureNatalCompilationRequestV1,
} from '../../src/bazi/compilation-contracts.mjs';
import {
  assertResolvedReleaseContext,
  assertSelectedRelationProfile,
} from '../../src/release/manifest.mjs';
import { parseCanonicalJsonV1 } from '../../src/shared/canonical.mjs';
import { assertDeterministicTableContext } from '../../src/bazi/materials.mjs';
import { ACTIVE_PROFILE_ID, compilationInputs } from '../natal-fixtures.mjs';
import { RELEASE_CONTEXT } from '../helpers.mjs';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const BASE_SNAPSHOT = {
  version: 'bazi.chart_snapshot.v2',
  snapshotId: 'snapshot:contracts',
  subjectRef: 'subject:contracts',
  validTimeRef: 'time:contracts',
  traditionalSexClass: 'male',
  provenanceRef: 'calendar:contracts',
  pillars: {
    year: { stemId: 'geng', branchId: 'chen' },
    month: { stemId: 'gui', branchId: 'wei' },
    day: { stemId: 'wu', branchId: 'yin' },
    hour: { stemId: 'geng', branchId: 'shen' },
  },
};

function resealCandidate(candidate) {
  const body = structuredClone(candidate);
  delete body.snapshotHash;
  candidate.snapshotHash = domainHashV1('bazi.candidate_snapshot.v1', body);
}

function resealCandidateSet(set) {
  const body = structuredClone(set);
  delete body.candidateSnapshotSetHash;
  set.candidateSnapshotSetHash = domainHashV1('bazi.candidate_snapshot_set.v2', body);
}

function resealRelease(manifest, { table = true } = {}) {
  if (table && manifest.deterministicTableManifest?.tables) {
    const tableBody = structuredClone(manifest.deterministicTableManifest);
    delete tableBody.deterministicTableManifestHash;
    manifest.deterministicTableManifest.deterministicTableManifestHash = contentHashV1(tableBody);
  }
  const candidatePreimage = Object.fromEntries(Object.entries(manifest).filter(([key]) => ![
    'releaseCandidate', 'auditReports', 'releaseAdmissionRecord', 'semanticIdentity',
  ].includes(key)));
  const candidateManifestHash = contentHashV1(candidatePreimage);
  manifest.releaseCandidate.candidateManifestHash = candidateManifestHash;
  for (const report of manifest.auditReports ?? []) report.candidateManifestHash = candidateManifestHash;
  manifest.releaseAdmissionRecord.candidateManifestHash = candidateManifestHash;
  manifest.releaseAdmissionRecord.auditReportHashes = (manifest.auditReports ?? []).map(contentHashV1);
  delete manifest.semanticIdentity.releaseManifestHash;
  manifest.semanticIdentity.releaseManifestHash = contentHashV1(manifest);
  return manifest;
}

const readManifest = () => JSON.parse(readFileSync(
  new URL('../../release-manifest.json', import.meta.url),
  'utf8',
));

function traceInput(trace, overrides = {}) {
  const body = structuredClone(trace);
  delete body.calendarDecisionTraceHash;
  return { ...body, ...overrides };
}

test('canonical encoding fixes Unicode, ordering, arrays, null and transport failures', () => {
  assert.equal(contentHashV1({ b: 2, a: 1 }), contentHashV1({ a: 1, b: 2 }));
  assert.equal(contentHashV1({ text: 'e\u0301' }), contentHashV1({ text: '\u00e9' }));
  assert.notEqual(contentHashV1({ list: ['a', 'b'] }), contentHashV1({ list: ['b', 'a'] }));
  assert.notEqual(contentHashV1({ value: null }), contentHashV1({}));
  assert.equal(canonicalJsonV1(-0), '0');
assert.throws(() => canonicalJsonV1(Number.POSITIVE_INFINITY), /finite JSON data/);
assert.throws(() => canonicalJsonV1(undefined), /must be JSON data/);
  assert.throws(() => domainHashV1('', {}), /domainTag/);
  assert.throws(() => domainHashV1('e\u0301', {}), /domainTag/);
  assert.deepEqual(parseCanonicalJsonV1(new TextEncoder().encode('{"a":1}'), 'x'), { a: 1 });
  assert.throws(() => parseCanonicalJsonV1(1, 'x'), /canonical JSON text/);
  assert.throws(() => parseCanonicalJsonV1('{', 'x'), /not valid JSON/);
  assert.throws(() => parseCanonicalJsonV1('[]', 'x'), /JSON object/);
});

test('snapshot readers preserve legacy compatibility and reject every identity mismatch', () => {
  const frozen = freezeBaziChartSnapshot(BASE_SNAPSHOT);
  assert.equal(assertBaziChartSnapshot(BASE_SNAPSHOT), true);
  assert.deepEqual(freezeBaziChartSnapshotFromCanonicalJson(canonicalJsonV1(BASE_SNAPSHOT)), frozen);
  assert.deepEqual(
    freezeBaziChartSnapshotFromCanonicalJson(new TextEncoder().encode(canonicalJsonV1(BASE_SNAPSHOT))),
    frozen,
  );
  assert.throws(() => freezeBaziChartSnapshot({ ...BASE_SNAPSHOT, version: 'bad' }), /version must/);
  assert.throws(() => freezeBaziChartSnapshot({ ...BASE_SNAPSHOT, traditionalSexClass: 'x' }), /traditionalSexClass/);
  for (const field of ['snapshotHash', 'inputSnapshotHash', 'coordinateContentHash']) {
    assert.throws(() => freezeBaziChartSnapshot({ ...BASE_SNAPSHOT, [field]: HASH_A }), new RegExp(field));
  }
  assert.throws(
    () => freezeBaziChartSnapshot({ ...BASE_SNAPSHOT, structuralContentHash: HASH_A }),
    /structuralContentHash/,
  );
  const legacy = { ...BASE_SNAPSHOT, version: 'bazi.chart_snapshot.v1' };
  delete legacy.traditionalSexClass;
  const legacyFrozen = freezeBaziChartSnapshot(legacy);
  assert.equal('traditionalSexClass' in legacyFrozen, false);
});

test('candidate, trace, envelope and request contracts reject malformed lifecycle records', () => {
  const input = compilationInputs([{ snapshot: BASE_SNAPSHOT }], { metadata: { note: 'one' } });
  const candidate = input.candidateSet.candidates[0];
  assert.throws(() => buildCandidateSnapshotV1({ ...candidate, snapshotHash: candidate.snapshotHash }), /unknown fields/);
  const { snapshotHash: ignoredSnapshotHash, ...candidateBody } = candidate;
  assert.ok(ignoredSnapshotHash);
  assert.throws(() => buildCandidateSnapshotV1({ ...candidateBody, version: 'bad' }), /unsupported/);
  assert.throws(() => buildCandidateSnapshotSetV2({
    version: 'bad', inputFactHash: HASH_A, calendarResolutionId: 'r', candidates: [],
  }), /version/);
  assert.throws(() => buildCandidateSnapshotSetV2({
    version: CANDIDATE_SNAPSHOT_SET_VERSION, inputFactHash: HASH_A,
    calendarResolutionId: 'r', candidates: null,
  }), /candidates must be an array/);
  const rawSet = buildCandidateSnapshotSetV2({
    version: CANDIDATE_SNAPSHOT_SET_VERSION,
    inputFactHash: input.candidateSet.inputFactHash,
    calendarResolutionId: input.candidateSet.calendarResolutionId,
    candidates: [candidateBody],
  });
  assert.equal(rawSet.candidates[0].snapshotHash, candidate.snapshotHash);

  const malformed = structuredClone(input.candidateSet);
  malformed.version = 'bad';
  assert.throws(() => captureCandidateSnapshotSetV2(malformed), /malformed/);
  const nonArray = structuredClone(input.candidateSet);
  nonArray.candidates = null;
  assert.throws(() => captureCandidateSnapshotSetV2(nonArray), /malformed/);
  const foreign = structuredClone(input.candidateSet);
  foreign.candidates[0].inputFactHash = HASH_B;
  resealCandidate(foreign.candidates[0]);
  resealCandidateSet(foreign);
  assert.throws(() => captureCandidateSnapshotSetV2(foreign), /belong to one input/);
  const foreignResolution = structuredClone(input.candidateSet);
  foreignResolution.candidates[0].calendarResolutionId = 'foreign';
  resealCandidate(foreignResolution.candidates[0]);
  resealCandidateSet(foreignResolution);
  assert.throws(() => captureCandidateSnapshotSetV2(foreignResolution), /belong to one input/);

  assert.throws(() => buildNatalCalendarDecisionTraceV1({
    version: 'bad', inputFactHash: HASH_A, calendarResolutionId: 'r', candidatePaths: [], decisions: {},
  }), /version/);
  assert.throws(() => buildNatalCalendarDecisionTraceV1({
    version: NATAL_CALENDAR_DECISION_TRACE_VERSION, inputFactHash: HASH_A,
    calendarResolutionId: 'r', candidatePaths: null, decisions: {},
  }), /candidatePaths/);
  assert.throws(() => buildNatalCalendarDecisionTraceV1({
    version: NATAL_CALENDAR_DECISION_TRACE_VERSION, inputFactHash: HASH_A,
    calendarResolutionId: 'r', candidatePaths: [{
      candidateOrdinal: -1, candidateId: 'c', candidateDecisionPathRef: 'p', decisionPath: {},
    }], decisions: {},
  }), /non-negative/);
  assert.throws(
    () => captureNatalCalendarDecisionTraceV1({ ...input.trace, calendarDecisionTraceHash: HASH_A }),
    /does not match/,
  );
  const wrongReleaseReference = buildNatalCompilationRequestV1({
    version: NATAL_COMPILATION_REQUEST_VERSION,
    requestSchemaVersion: NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
    candidateSnapshotSetHash: input.candidateSet.candidateSnapshotSetHash,
    calendarDecisionTraceHash: input.trace.calendarDecisionTraceHash,
    releaseManifestHash: HASH_A,
    activeProfileId: ACTIVE_PROFILE_ID,
  });
  assert.throws(
    () => compileNatalRequest(wrongReleaseReference, input.candidateSet, input.trace, input.releaseContext),
    /hash references/,
  );

  const envelopeInput = {
    version: CALENDAR_RESOLUTION_ENVELOPE_VERSION,
    inputFactHash: input.candidateSet.inputFactHash,
    calendarResolutionId: input.candidateSet.calendarResolutionId,
    calendarProviderIdentity: { provider: 'test' },
    calendarProfileHash: HASH_A,
    calendarDecisionTraceHash: input.trace.calendarDecisionTraceHash,
    candidateSnapshotSetHash: input.candidateSet.candidateSnapshotSetHash,
    precisionPolicy: { mode: 'exact' },
    resolutionSchemaVersion: 'calendar.test.v1',
  };
  assert.match(buildCalendarResolutionEnvelopeV1(envelopeInput).calendarResolutionEnvelopeHash, /^sha256:/);
  assert.throws(() => buildCalendarResolutionEnvelopeV1({ ...envelopeInput, version: 'bad' }), /version/);
  assert.throws(
    () => buildCalendarResolutionEnvelopeV1({ ...envelopeInput, calendarProfileHash: 'bad' }),
    /sha256 hash/,
  );

  const requestInput = {
    version: NATAL_COMPILATION_REQUEST_VERSION,
    requestSchemaVersion: NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
    candidateSnapshotSetHash: input.candidateSet.candidateSnapshotSetHash,
    calendarDecisionTraceHash: input.trace.calendarDecisionTraceHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
  };
  assert.throws(() => buildNatalCompilationRequestV1({ ...requestInput, version: 'bad' }), /version/);
  assert.throws(() => buildNatalCompilationRequestV1({ ...requestInput, requestSchemaVersion: 'bad' }), /version/);
  const requestA = buildNatalCompilationRequestV1({ ...requestInput, metadata: { host: 'a' } });
  const requestB = buildNatalCompilationRequestV1({ ...requestInput, metadata: { host: 'b' } });
  assert.equal(requestA.requestHash, requestB.requestHash);
  assert.throws(
    () => captureNatalCompilationRequestV1({ ...requestA, requestHash: HASH_A }),
    /requestHash/,
  );
});

test('cross-input validation rejects mismatched resolution, path count and path identity', () => {
  const input = compilationInputs([{ snapshot: BASE_SNAPSHOT }]);
  const compileWithTrace = (trace) => {
    const request = buildNatalCompilationRequestV1({
      version: NATAL_COMPILATION_REQUEST_VERSION,
      requestSchemaVersion: NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
      candidateSnapshotSetHash: input.candidateSet.candidateSnapshotSetHash,
      calendarDecisionTraceHash: trace.calendarDecisionTraceHash,
      releaseManifestHash: input.releaseContext.releaseManifestHash,
      activeProfileId: ACTIVE_PROFILE_ID,
    });
    return compileNatalRequest(request, input.candidateSet, trace, input.releaseContext);
  };
  const wrongResolution = buildNatalCalendarDecisionTraceV1(traceInput(
    input.trace,
    { calendarResolutionId: 'different' },
  ));
  assert.throws(() => compileWithTrace(wrongResolution), /same resolution/);
  const noPath = buildNatalCalendarDecisionTraceV1(traceInput(input.trace, { candidatePaths: [] }));
  assert.throws(() => compileWithTrace(noPath), /path count/);
  const wrongPath = buildNatalCalendarDecisionTraceV1(traceInput(input.trace, {
    candidatePaths: [{ ...input.trace.candidatePaths[0], candidateId: 'different' }],
  }));
  assert.throws(() => compileWithTrace(wrongPath), /paths must match/);
  const wrongOrdinalPath = buildNatalCalendarDecisionTraceV1(traceInput(input.trace, {
    candidatePaths: [{ ...input.trace.candidatePaths[0], candidateOrdinal: 1 }],
  }));
  assert.throws(() => compileWithTrace(wrongOrdinalPath), /paths must match/);
  const wrongPathRef = buildNatalCalendarDecisionTraceV1(traceInput(input.trace, {
    candidatePaths: [{ ...input.trace.candidatePaths[0], candidateDecisionPathRef: 'different' }],
  }));
  assert.throws(() => compileWithTrace(wrongPathRef), /paths must match/);
  const wrongReference = buildNatalCompilationRequestV1({
    version: NATAL_COMPILATION_REQUEST_VERSION,
    requestSchemaVersion: NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
    candidateSnapshotSetHash: HASH_A,
    calendarDecisionTraceHash: input.trace.calendarDecisionTraceHash,
    releaseManifestHash: input.releaseContext.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
  });
  assert.throws(
    () => compileNatalRequest(wrongReference, input.candidateSet, input.trace, input.releaseContext),
    /hash references/,
  );
  const jsonBatch = compileNatalRequest(
    canonicalJsonV1(input.request),
    new TextEncoder().encode(canonicalJsonV1(input.candidateSet)),
    canonicalJsonV1(input.trace),
    input.releaseContext,
  );
  assert.equal(jsonBatch.status, 'compiled');
  assert.deepEqual(canonicalResultOrder([
    { candidateOrdinal: 0, candidateId: 'b' },
    { candidateOrdinal: 0, candidateId: 'a' },
  ]).map((row) => row.candidateId), ['a', 'b']);
  assert.equal(canonicalResultOrder([
    { candidateOrdinal: 0, candidateId: 'same' },
    { candidateOrdinal: 0, candidateId: 'same' },
  ]).length, 2);
});

test('release admission rejects every mutable authority seam before context resolution', () => {
  assert.equal(
    assertDeterministicTableContext(RELEASE_CONTEXT.deterministicTableContext),
    RELEASE_CONTEXT.deterministicTableContext,
  );
  assert.throws(() => assertDeterministicTableContext(null), /DeterministicTableManifest/);
  const reject = (mutate, expected, options) => {
    const manifest = readManifest();
    mutate(manifest);
    resealRelease(manifest, options);
    assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(manifest)), expected);
  };
  reject((m) => { m.version = 'bad'; }, /version or schema/);
  reject((m) => { m.releaseCandidate.version = 'bad'; }, /ReleaseCandidateManifestV1/);
  {
    const m = readManifest();
    m.releaseCandidate.candidateManifestHash = HASH_A;
    assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(m)), /candidateManifestHash/);
  }
  {
    const m = readManifest();
    m.releaseCandidate.candidateManifestHash = 'bad';
    assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(m)), /full sha256/);
  }
  {
    const m = readManifest();
    delete m.releaseCandidate.candidateManifestHash;
    assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(m)), /full sha256/);
  }
  reject((m) => { m.auditReports = []; }, /requires audit reports/);
  reject((m) => { m.auditReports[0].releaseManifestHash = HASH_A; }, /must not contain/);
  {
    const m = resealRelease(readManifest());
    m.auditReports[0].candidateManifestHash = HASH_A;
    assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(m)), /does not bind/);
  }
  reject((m) => { m.releaseAdmissionRecord.status = 'rejected'; }, /ReleaseAdmissionRecord/);
  {
    const m = readManifest();
    m.semanticIdentity.releaseManifestHash = HASH_A;
    assert.throws(() => admitReleaseManifestV2(canonicalJsonV1(m)), /releaseManifestHash/);
  }
  reject((m) => { delete m.deterministicTableManifest.tables; }, /versioned deterministicTableManifest/, { table: false });
  reject((m) => { m.deterministicTableManifest.deterministicTableManifestHash = HASH_A; }, /DeterministicTableManifest hash/, { table: false });
  reject((m) => { m.deterministicTableManifest.tables.push(structuredClone(m.deterministicTableManifest.tables[0])); }, /duplicate deterministic table/);
  reject((m) => { m.deterministicTableManifest.tables.push({ tableId: 'unregistered', contentHash: HASH_A }); }, /unregistered deterministic table/);
  reject((m) => { m.deterministicTableManifest.tables[0].contentHash = HASH_A; }, /content hash mismatch/);
  reject((m) => { m.deterministicTableManifest.tables.pop(); }, /required deterministic table missing/);
  reject((m) => { m.relationProfiles = {}; }, /versioned relationProfiles registry/);
  reject((m) => { m.relationProfiles.activeProfileId = ACTIVE_PROFILE_ID; }, /must not select/);
  reject((m) => { m.relationProfiles.entries.push(structuredClone(m.relationProfiles.entries[0])); }, /duplicate RelationProfile/);
  reject((m) => { delete m.relationProfiles.entries[0].profileSchemaVersion; }, /unversioned/);
  reject((m) => { m.relationProfiles.entries[0].profileId = 'unregistered'; }, /unregistered RelationProfile/);
  reject((m) => { m.relationProfiles.entries[0].contentHash = HASH_A; }, /content hash mismatch/);
  reject((m) => {
    m.canonicalEncodingProfile.profileHash = HASH_A;
    m.hashingProfile.canonicalEncodingProfileHash = HASH_A;
  }, /CanonicalEncodingProfile/);
  reject((m) => { m.hashingProfile.profileHash = HASH_A; }, /HashingProfile/);
  reject((m) => {
    m.hashingProfile.canonicalEncodingProfileHash = HASH_A;
    const body = structuredClone(m.hashingProfile);
    delete body.profileHash;
    m.hashingProfile.profileHash = contentHashV1(body);
  }, /does not bind/);
  reject((m) => { m.structuralCandidateEnumerator.enumeratorVersion = 'bad'; }, /Enumerator identity/);

  assert.throws(() => assertResolvedReleaseContext({}), /admitReleaseManifestV2/);
  assert.throws(() => assertSelectedRelationProfile({}), /resolveSelectedRelationProfile/);
  assert.throws(() => resolveSelectedRelationProfile(RELEASE_CONTEXT, ''), /activeProfileId/);
  assert.throws(() => resolveSelectedRelationProfile(RELEASE_CONTEXT, 'missing'), /not admitted/);
});
