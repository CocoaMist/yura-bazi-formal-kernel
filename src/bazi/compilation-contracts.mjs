import {
  captureExactDataRecord,
  captureJsonData,
  deepFreeze,
  requiredString,
} from '../shared/assert.mjs';
import { compareCanonical, domainHashV1, parseCanonicalJsonV1 } from '../shared/canonical.mjs';
import { freezeBaziChartSnapshot } from './snapshot.mjs';

export const CANDIDATE_SNAPSHOT_VERSION = 'bazi.candidate_snapshot.v1';
export const CANDIDATE_SNAPSHOT_SET_VERSION = 'bazi.candidate_snapshot_set.v2';
export const NATAL_CALENDAR_DECISION_TRACE_VERSION = 'bazi.natal_calendar_decision_trace.v1';
export const CALENDAR_RESOLUTION_ENVELOPE_VERSION = 'bazi.calendar_resolution_envelope.v1';
export const NATAL_COMPILATION_REQUEST_VERSION = 'bazi.natal_compilation_request.v1';
export const NATAL_COMPILATION_REQUEST_SCHEMA_VERSION = 'bazi.natal_compilation_request.schema.v1';

function sourceObject(value, field) {
  return typeof value === 'string' || value instanceof Uint8Array
    ? parseCanonicalJsonV1(value, field)
    : value;
}

function hash(value, field) {
  const result = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) throw new TypeError(`${field} must be a sha256 hash`);
  return result;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function captureCandidateSnapshot(value, field) {
  const source = captureExactDataRecord(sourceObject(value, field), [
    'version', 'candidateOrdinal', 'candidateId', 'inputFactHash',
    'calendarResolutionId', 'candidateDecisionPathRef', 'snapshot', 'snapshotHash',
  ], field);
  if (source.version !== CANDIDATE_SNAPSHOT_VERSION) throw new TypeError(`${field}.version is unsupported`);
  const body = deepFreeze({
    version: source.version,
    candidateOrdinal: nonNegativeInteger(source.candidateOrdinal, `${field}.candidateOrdinal`),
    candidateId: requiredString(source.candidateId, `${field}.candidateId`),
    inputFactHash: hash(source.inputFactHash, `${field}.inputFactHash`),
    calendarResolutionId: requiredString(source.calendarResolutionId, `${field}.calendarResolutionId`),
    candidateDecisionPathRef: requiredString(
      source.candidateDecisionPathRef,
      `${field}.candidateDecisionPathRef`,
    ),
    snapshot: deepFreeze(captureJsonData(source.snapshot, `${field}.snapshot`)),
  });
  const expected = domainHashV1('bazi.candidate_snapshot.v1', body);
  if (source.snapshotHash !== expected) throw new TypeError(`${field}.snapshotHash does not match its preimage`);
  return deepFreeze({ ...body, snapshotHash: expected });
}

export function buildCandidateSnapshotV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'candidateOrdinal', 'candidateId', 'inputFactHash',
    'calendarResolutionId', 'candidateDecisionPathRef', 'snapshot',
  ], 'CandidateSnapshotV1');
  const body = deepFreeze({
    version: source.version,
    candidateOrdinal: source.candidateOrdinal,
    candidateId: source.candidateId,
    inputFactHash: source.inputFactHash,
    calendarResolutionId: source.calendarResolutionId,
    candidateDecisionPathRef: source.candidateDecisionPathRef,
    snapshot: deepFreeze(captureJsonData(source.snapshot, 'CandidateSnapshotV1.snapshot')),
  });
  return captureCandidateSnapshot({
    ...body,
    snapshotHash: domainHashV1('bazi.candidate_snapshot.v1', body),
  }, 'CandidateSnapshotV1');
}

export function buildCandidateSnapshotSetV2(input) {
  const source = captureExactDataRecord(input, [
    'version', 'inputFactHash', 'calendarResolutionId', 'candidates',
  ], 'CandidateSnapshotSetV2');
  if (source.version !== CANDIDATE_SNAPSHOT_SET_VERSION) {
    throw new TypeError('CandidateSnapshotSetV2.version is unsupported');
  }
  if (!Array.isArray(source.candidates)) throw new TypeError('CandidateSnapshotSetV2.candidates must be an array');
  const candidates = source.candidates.map((candidate, index) => {
    const built = Object.hasOwn(candidate, 'snapshotHash')
      ? captureCandidateSnapshot(candidate, `CandidateSnapshotSetV2.candidates[${index}]`)
      : buildCandidateSnapshotV1(candidate);
    return built;
  });
  const body = deepFreeze({
    version: source.version,
    inputFactHash: hash(source.inputFactHash, 'CandidateSnapshotSetV2.inputFactHash'),
    calendarResolutionId: requiredString(
      source.calendarResolutionId,
      'CandidateSnapshotSetV2.calendarResolutionId',
    ),
    candidateCount: candidates.length,
    candidates,
  });
  return captureCandidateSnapshotSetV2({
    ...body,
    candidateSnapshotSetHash: domainHashV1('bazi.candidate_snapshot_set.v2', body),
  });
}

export function captureCandidateSnapshotSetV2(value) {
  const source = captureExactDataRecord(sourceObject(value, 'CandidateSnapshotSetV2'), [
    'version', 'inputFactHash', 'calendarResolutionId', 'candidateCount',
    'candidates', 'candidateSnapshotSetHash',
  ], 'CandidateSnapshotSetV2');
  if (source.version !== CANDIDATE_SNAPSHOT_SET_VERSION || !Array.isArray(source.candidates)) {
    throw new TypeError('CandidateSnapshotSetV2 is malformed');
  }
  if (source.candidateCount !== source.candidates.length) {
    throw new TypeError('CandidateSnapshotSetV2.candidateCount does not match candidates.length');
  }
  const candidates = source.candidates.map((candidate, index) => captureCandidateSnapshot(
    candidate,
    `CandidateSnapshotSetV2.candidates[${index}]`,
  ));
  const inputFactHash = hash(source.inputFactHash, 'CandidateSnapshotSetV2.inputFactHash');
  const calendarResolutionId = requiredString(
    source.calendarResolutionId,
    'CandidateSnapshotSetV2.calendarResolutionId',
  );
  const ids = new Set();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.candidateOrdinal !== index) {
      throw new TypeError('CandidateSnapshotSetV2 ordinals must be unique, continuous and canonically ordered');
    }
    if (ids.has(candidate.candidateId)) throw new TypeError(`duplicate candidateId: ${candidate.candidateId}`);
    ids.add(candidate.candidateId);
    if (candidate.inputFactHash !== inputFactHash
      || candidate.calendarResolutionId !== calendarResolutionId) {
      throw new TypeError('all CandidateSnapshotV1 records must belong to one input and calendar resolution');
    }
  }
  const body = deepFreeze({
    version: source.version,
    inputFactHash,
    calendarResolutionId,
    candidateCount: candidates.length,
    candidates,
  });
  const expected = domainHashV1('bazi.candidate_snapshot_set.v2', body);
  if (source.candidateSnapshotSetHash !== expected) {
    throw new TypeError('CandidateSnapshotSetV2.candidateSnapshotSetHash does not match its preimage');
  }
  return deepFreeze({ ...body, candidateSnapshotSetHash: expected });
}

export function buildNatalCalendarDecisionTraceV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'inputFactHash', 'calendarResolutionId', 'candidatePaths', 'decisions',
  ], 'NatalCalendarDecisionTraceV1');
  if (source.version !== NATAL_CALENDAR_DECISION_TRACE_VERSION) {
    throw new TypeError('NatalCalendarDecisionTraceV1.version is unsupported');
  }
  if (!Array.isArray(source.candidatePaths)) {
    throw new TypeError('NatalCalendarDecisionTraceV1.candidatePaths must be an array');
  }
  const candidatePaths = source.candidatePaths.map((path, index) => {
    const row = captureExactDataRecord(path, [
      'candidateOrdinal', 'candidateId', 'candidateDecisionPathRef', 'decisionPath',
    ], `NatalCalendarDecisionTraceV1.candidatePaths[${index}]`);
    return deepFreeze({
      candidateOrdinal: nonNegativeInteger(row.candidateOrdinal, 'candidatePath.candidateOrdinal'),
      candidateId: requiredString(row.candidateId, 'candidatePath.candidateId'),
      candidateDecisionPathRef: requiredString(
        row.candidateDecisionPathRef,
        'candidatePath.candidateDecisionPathRef',
      ),
      decisionPath: deepFreeze(captureJsonData(row.decisionPath, 'candidatePath.decisionPath')),
    });
  });
  const body = deepFreeze({
    version: source.version,
    inputFactHash: hash(source.inputFactHash, 'NatalCalendarDecisionTraceV1.inputFactHash'),
    calendarResolutionId: requiredString(
      source.calendarResolutionId,
      'NatalCalendarDecisionTraceV1.calendarResolutionId',
    ),
    candidatePaths,
    decisions: deepFreeze(captureJsonData(source.decisions, 'NatalCalendarDecisionTraceV1.decisions')),
  });
  return deepFreeze({
    ...body,
    calendarDecisionTraceHash: domainHashV1('bazi.natal_calendar_decision_trace.v1', body),
  });
}

export function captureNatalCalendarDecisionTraceV1(value) {
  const source = sourceObject(value, 'NatalCalendarDecisionTraceV1');
  const { calendarDecisionTraceHash, ...body } = captureExactDataRecord(source, [
    'version', 'inputFactHash', 'calendarResolutionId', 'candidatePaths',
    'decisions', 'calendarDecisionTraceHash',
  ], 'NatalCalendarDecisionTraceV1');
  const trace = buildNatalCalendarDecisionTraceV1(body);
  if (calendarDecisionTraceHash !== trace.calendarDecisionTraceHash) {
    throw new TypeError('NatalCalendarDecisionTraceV1.calendarDecisionTraceHash does not match its preimage');
  }
  return trace;
}

export function buildCalendarResolutionEnvelopeV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'inputFactHash', 'calendarResolutionId', 'calendarProviderIdentity',
    'calendarProfileHash', 'calendarDecisionTraceHash', 'candidateSnapshotSetHash',
    'precisionPolicy', 'resolutionSchemaVersion',
  ], 'CalendarResolutionEnvelopeV1');
  if (source.version !== CALENDAR_RESOLUTION_ENVELOPE_VERSION) {
    throw new TypeError('CalendarResolutionEnvelopeV1.version is unsupported');
  }
  const body = deepFreeze({
    version: source.version,
    inputFactHash: hash(source.inputFactHash, 'CalendarResolutionEnvelopeV1.inputFactHash'),
    calendarResolutionId: requiredString(source.calendarResolutionId, 'CalendarResolutionEnvelopeV1.calendarResolutionId'),
    calendarProviderIdentity: deepFreeze(captureJsonData(source.calendarProviderIdentity, 'CalendarResolutionEnvelopeV1.calendarProviderIdentity')),
    calendarProfileHash: hash(source.calendarProfileHash, 'CalendarResolutionEnvelopeV1.calendarProfileHash'),
    calendarDecisionTraceHash: hash(source.calendarDecisionTraceHash, 'CalendarResolutionEnvelopeV1.calendarDecisionTraceHash'),
    candidateSnapshotSetHash: hash(source.candidateSnapshotSetHash, 'CalendarResolutionEnvelopeV1.candidateSnapshotSetHash'),
    precisionPolicy: deepFreeze(captureJsonData(source.precisionPolicy, 'CalendarResolutionEnvelopeV1.precisionPolicy')),
    resolutionSchemaVersion: requiredString(source.resolutionSchemaVersion, 'CalendarResolutionEnvelopeV1.resolutionSchemaVersion'),
  });
  return deepFreeze({
    ...body,
    calendarResolutionEnvelopeHash: domainHashV1('bazi.calendar_resolution_envelope.v1', body),
  });
}

export function buildNatalCompilationRequestV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'requestSchemaVersion', 'candidateSnapshotSetHash',
    'calendarDecisionTraceHash', 'releaseManifestHash', 'activeProfileId', 'metadata',
  ], 'NatalCompilationRequestV1');
  if (source.version !== NATAL_COMPILATION_REQUEST_VERSION
    || source.requestSchemaVersion !== NATAL_COMPILATION_REQUEST_SCHEMA_VERSION) {
    throw new TypeError('NatalCompilationRequestV1 version or schema version is unsupported');
  }
  const body = deepFreeze({
    version: source.version,
    requestSchemaVersion: source.requestSchemaVersion,
    candidateSnapshotSetHash: hash(source.candidateSnapshotSetHash, 'NatalCompilationRequestV1.candidateSnapshotSetHash'),
    calendarDecisionTraceHash: hash(source.calendarDecisionTraceHash, 'NatalCompilationRequestV1.calendarDecisionTraceHash'),
    releaseManifestHash: hash(source.releaseManifestHash, 'NatalCompilationRequestV1.releaseManifestHash'),
    activeProfileId: requiredString(source.activeProfileId, 'NatalCompilationRequestV1.activeProfileId'),
  });
  return deepFreeze({
    ...body,
    requestHash: domainHashV1('bazi.natal_compilation_request.v1', body),
    ...(Object.hasOwn(source, 'metadata')
      ? { metadata: deepFreeze(captureJsonData(source.metadata, 'NatalCompilationRequestV1.metadata')) }
      : {}),
  });
}

export function captureNatalCompilationRequestV1(value) {
  const source = sourceObject(value, 'NatalCompilationRequestV1');
  const captured = captureExactDataRecord(source, [
    'version', 'requestSchemaVersion', 'candidateSnapshotSetHash',
    'calendarDecisionTraceHash', 'releaseManifestHash', 'activeProfileId', 'requestHash', 'metadata',
  ], 'NatalCompilationRequestV1');
  const { requestHash, ...requestInput } = captured;
  const request = buildNatalCompilationRequestV1(requestInput);
  if (requestHash !== request.requestHash) {
    throw new TypeError('NatalCompilationRequestV1.requestHash does not match its semantic preimage');
  }
  return request;
}

export function validateNatalCompilationInputs(requestValue, candidateSetValue, traceValue, releaseContext) {
  const request = captureNatalCompilationRequestV1(requestValue);
  const candidateSet = captureCandidateSnapshotSetV2(candidateSetValue);
  const trace = captureNatalCalendarDecisionTraceV1(traceValue);
  if (request.candidateSnapshotSetHash !== candidateSet.candidateSnapshotSetHash
    || request.calendarDecisionTraceHash !== trace.calendarDecisionTraceHash
    || request.releaseManifestHash !== releaseContext.releaseManifestHash) {
    throw new TypeError('NatalCompilationRequestV1 hash references do not match supplied inputs');
  }
  if (candidateSet.inputFactHash !== trace.inputFactHash
    || candidateSet.calendarResolutionId !== trace.calendarResolutionId) {
    throw new TypeError('candidate set and calendar trace do not belong to the same resolution');
  }
  if (trace.candidatePaths.length !== candidateSet.candidateCount) {
    throw new TypeError('calendar trace candidate path count does not match candidate set');
  }
  for (let index = 0; index < candidateSet.candidateCount; index += 1) {
    const candidate = candidateSet.candidates[index];
    const path = trace.candidatePaths[index];
    if (path.candidateOrdinal !== index || path.candidateId !== candidate.candidateId
      || path.candidateDecisionPathRef !== candidate.candidateDecisionPathRef) {
      throw new TypeError('calendar trace paths must match candidates by canonical ordinal');
    }
  }
  return deepFreeze({ request, candidateSet, trace });
}

export function validateCandidateSnapshotV1(candidate) {
  const snapshot = freezeBaziChartSnapshot(candidate.snapshot);
  return deepFreeze({
    version: 'bazi.validated_candidate_snapshot.v1',
    originalCandidateSnapshot: candidate,
    originalSnapshotHash: candidate.snapshotHash,
    normalizedChartSnapshot: snapshot,
    normalizedChartSnapshotHash: snapshot.snapshotHash,
  });
}

export function canonicalResultOrder(results) {
  return Object.freeze([...results].sort((left, right) => (
    left.candidateOrdinal - right.candidateOrdinal
    || compareCanonical(left.candidateId, right.candidateId)
  )));
}
