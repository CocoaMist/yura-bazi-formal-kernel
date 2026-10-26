import {
  assertNonEmptyString,
  captureJson,
  captureRecord,
  deepFreeze,
  domainHash,
  fail,
} from './shared.mjs';

export const CANDIDATE_SNAPSHOT_SET_VERSION = 'bazi.candidate_snapshot_set.v2';
export const CALENDAR_RESOLUTION_ENVELOPE_VERSION = 'bazi.calendar_resolution_envelope.v1';
export const NATAL_CALENDAR_DECISION_TRACE_VERSION = 'bazi.natal_calendar_decision_trace.v1';

function requireHash(value, label) {
  const result = assertNonEmptyString(value, label);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) fail(`${label} must be a sha256 hash`);
  return result;
}

export function buildNatalCalendarArtifacts(value) {
  const input = captureRecord(value, 'natalCalendarArtifactsRequest', [
    'version', 'inputFactHash', 'subjectRef', 'validTimeRef',
    'traditionalSexClass', 'precisionPolicy', 'resolutions',
  ]);
  if (input.version !== 'bazi.natal_calendar_artifacts_request.v1') {
    fail('natalCalendarArtifactsRequest.version is unsupported');
  }
  if (!['male', 'female', 'unknown'].includes(input.traditionalSexClass)) {
    fail('natalCalendarArtifactsRequest.traditionalSexClass must be male, female or unknown');
  }
  if (!Array.isArray(input.resolutions)) fail('natalCalendarArtifactsRequest.resolutions must be an array');
  const inputFactHash = requireHash(input.inputFactHash, 'natalCalendarArtifactsRequest.inputFactHash');
  const subjectRef = assertNonEmptyString(input.subjectRef, 'natalCalendarArtifactsRequest.subjectRef');
  const validTimeRef = assertNonEmptyString(input.validTimeRef, 'natalCalendarArtifactsRequest.validTimeRef');
  const precisionPolicy = captureJson(input.precisionPolicy, 'natalCalendarArtifactsRequest.precisionPolicy');
  const resolutions = captureJson(input.resolutions, 'natalCalendarArtifactsRequest.resolutions');
  for (let index = 0; index < resolutions.length; index += 1) {
    const resolution = resolutions[index];
    if (resolution.version !== 'bazi.calendar_resolution.v2'
      || resolution.resolved?.mode !== 'instant'
      || resolution.resolved?.decisionTrace == null) {
      fail(`natalCalendarArtifactsRequest.resolutions[${index}] must be a traced instant calendar resolution`);
    }
  }
  const providerIdentities = resolutions.map((resolution) => resolution.provider);
  const calendarProfileHash = domainHash('bazi.calendar_profile_set.v1', resolutions.map(
    (resolution) => resolution.request.boundaryProfileId,
  ));
  const calendarResolutionId = `calendar-resolution:${domainHash('bazi.calendar_resolution_identity.v1', {
    inputFactHash,
    precisionPolicy,
    providerIdentities,
    resolutionHashes: resolutions.map((resolution) => resolution.resolutionHash),
  })}`;
  const candidates = resolutions.map((resolution, candidateOrdinal) => {
    const candidateDecisionPathRef = `calendar-path:${domainHash('bazi.calendar_candidate_path.v1', {
      calendarResolutionId,
      candidateOrdinal,
      resolutionHash: resolution.resolutionHash,
    })}`;
    const candidateId = `candidate:${candidateOrdinal}:${resolution.resolutionHash}`;
    const snapshotId = `snapshot:${resolution.resolutionHash}`;
    const snapshot = {
      version: 'bazi.chart_snapshot.v2',
      snapshotId,
      subjectRef,
      validTimeRef,
      traditionalSexClass: input.traditionalSexClass,
      pillars: resolution.resolved.layers,
      provenanceRef: `calendar:${resolution.resolved.provenance.authorityId}:${resolution.resolutionHash}`,
    };
    const body = {
      version: 'bazi.candidate_snapshot.v1',
      candidateOrdinal,
      candidateId,
      inputFactHash,
      calendarResolutionId,
      candidateDecisionPathRef,
      snapshot,
    };
    return deepFreeze({ ...body, snapshotHash: domainHash('bazi.candidate_snapshot.v1', body) });
  });
  const setBody = {
    version: CANDIDATE_SNAPSHOT_SET_VERSION,
    inputFactHash,
    calendarResolutionId,
    candidateCount: candidates.length,
    candidates,
  };
  const candidateSnapshotSet = deepFreeze({
    ...setBody,
    candidateSnapshotSetHash: domainHash('bazi.candidate_snapshot_set.v2', setBody),
  });
  const candidatePaths = resolutions.map((resolution, candidateOrdinal) => ({
    candidateOrdinal,
    candidateId: candidates[candidateOrdinal].candidateId,
    candidateDecisionPathRef: candidates[candidateOrdinal].candidateDecisionPathRef,
    decisionPath: resolution.resolved.decisionTrace,
  }));
  const traceBody = {
    version: NATAL_CALENDAR_DECISION_TRACE_VERSION,
    inputFactHash,
    calendarResolutionId,
    candidatePaths,
    decisions: {
      policy: 'all_calendar_admissible_instant_resolutions_retained',
      resolutionHashes: resolutions.map((resolution) => resolution.resolutionHash),
    },
  };
  const calendarDecisionTrace = deepFreeze({
    ...traceBody,
    calendarDecisionTraceHash:
      domainHash('bazi.natal_calendar_decision_trace.v1', traceBody),
  });
  const envelopeBody = {
    version: CALENDAR_RESOLUTION_ENVELOPE_VERSION,
    inputFactHash,
    calendarResolutionId,
    calendarProviderIdentity: providerIdentities,
    calendarProfileHash,
    calendarDecisionTraceHash: calendarDecisionTrace.calendarDecisionTraceHash,
    candidateSnapshotSetHash: candidateSnapshotSet.candidateSnapshotSetHash,
    precisionPolicy,
    resolutionSchemaVersion: 'bazi.calendar_resolution.v2',
  };
  const calendarResolutionEnvelope = deepFreeze({
    ...envelopeBody,
    calendarResolutionEnvelopeHash:
      domainHash('bazi.calendar_resolution_envelope.v1', envelopeBody),
  });
  return deepFreeze({ calendarResolutionEnvelope, calendarDecisionTrace, candidateSnapshotSet });
}

export function buildCandidateSnapshotSet(value) {
  return buildNatalCalendarArtifacts(value).candidateSnapshotSet;
}
