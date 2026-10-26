import {
  CANDIDATE_SNAPSHOT_SET_VERSION,
  CANDIDATE_SNAPSHOT_VERSION,
  NATAL_CALENDAR_DECISION_TRACE_VERSION,
  NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
  NATAL_COMPILATION_REQUEST_VERSION,
  buildCandidateSnapshotSetV2,
  buildCandidateSnapshotV1,
  buildNatalCalendarDecisionTraceV1,
  buildNatalCompilationRequestV1,
  compileNatalRequest,
  domainHashV1,
} from '../src/index.mjs';
import { RELEASE_CONTEXT } from './helpers.mjs';

export const ACTIVE_PROFILE_ID = 'bazi.relation_foundation.modern_common_raw_structure.v4';

export function compilationInputs(snapshotInputs, options = {}) {
  const inputFactHash = options.inputFactHash ?? domainHashV1('test.input_fact.v1', {
    subjectRef: snapshotInputs[0]?.snapshot?.subjectRef ?? 'subject:empty',
    validTimeRef: snapshotInputs[0]?.snapshot?.validTimeRef ?? 'time:empty',
  });
  const calendarResolutionId = options.calendarResolutionId ?? 'calendar-resolution:test';
  const candidates = snapshotInputs.map((item, candidateOrdinal) => buildCandidateSnapshotV1({
    version: CANDIDATE_SNAPSHOT_VERSION,
    candidateOrdinal,
    candidateId: item.candidateId ?? `candidate:${candidateOrdinal}`,
    inputFactHash,
    calendarResolutionId,
    candidateDecisionPathRef: item.candidateDecisionPathRef ?? `calendar-path:${candidateOrdinal}`,
    snapshot: item.snapshot,
  }));
  const candidateSet = buildCandidateSnapshotSetV2({
    version: CANDIDATE_SNAPSHOT_SET_VERSION,
    inputFactHash,
    calendarResolutionId,
    candidates,
  });
  const trace = buildNatalCalendarDecisionTraceV1({
    version: NATAL_CALENDAR_DECISION_TRACE_VERSION,
    inputFactHash,
    calendarResolutionId,
    candidatePaths: candidates.map((candidate) => ({
      candidateOrdinal: candidate.candidateOrdinal,
      candidateId: candidate.candidateId,
      candidateDecisionPathRef: candidate.candidateDecisionPathRef,
      decisionPath: { source: 'test', candidateOrdinal: candidate.candidateOrdinal },
    })),
    decisions: { policy: 'test_fixture' },
  });
  const request = buildNatalCompilationRequestV1({
    version: NATAL_COMPILATION_REQUEST_VERSION,
    requestSchemaVersion: NATAL_COMPILATION_REQUEST_SCHEMA_VERSION,
    candidateSnapshotSetHash: candidateSet.candidateSnapshotSetHash,
    calendarDecisionTraceHash: trace.calendarDecisionTraceHash,
    releaseManifestHash: (options.releaseContext ?? RELEASE_CONTEXT).releaseManifestHash,
    activeProfileId: options.activeProfileId ?? ACTIVE_PROFILE_ID,
    ...(Object.hasOwn(options, 'metadata') ? { metadata: options.metadata } : {}),
  });
  return { request, candidateSet, trace, releaseContext: options.releaseContext ?? RELEASE_CONTEXT };
}

export function compileSnapshots(snapshotInputs, options = {}) {
  const input = compilationInputs(snapshotInputs, options);
  return compileNatalRequest(input.request, input.candidateSet, input.trace, input.releaseContext);
}

export function compileOne(snapshot, options = {}) {
  const batch = compileSnapshots([{ candidateId: options.candidateId ?? 'candidate:test', snapshot }], options);
  const result = batch.results[0];
  if (result.status !== 'compiled') throw new TypeError(result.diagnostics?.message ?? result.stableErrorCode);
  return result.artifact;
}
