import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  buildNatalCalendarArtifacts,
  resolveTimeRequest,
} from '../src/index.mjs';

function request(solarTime, location) {
  return {
    version: 'bazi.time_request.v1',
    mode: 'instant',
    calendar: 'gregorian',
    timeZoneId: 'Asia/Shanghai',
    ...(location ? { location } : {}),
    solarTime,
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    input: { local: '2000-07-19T16:00:00' },
  };
}

test('calendar decisions become independent candidate snapshots without merging equal pillars', async () => {
  const civil = await resolveTimeRequest(request({ mode: 'civil' }), REFERENCE_CALENDAR_PROVIDER);
  const solar = await resolveTimeRequest(request({
    mode: 'true_solar', algorithmRef: REFERENCE_CALENDAR_PROFILE.trueSolarAlgorithmId,
  }, { longitude: 116.4074, latitude: 39.9042, label: 'Beijing' }), REFERENCE_CALENDAR_PROVIDER);
  assert.equal(civil.version, 'bazi.calendar_resolution.v2');
  assert.equal(civil.resolved.decisionTrace.decisions.effectiveClockIso, '2000-07-19T16:00:00.000');
  assert.match(solar.resolved.decisionTrace.decisions.effectiveClockIso, /^2000-07-19T15:39:/);
  assert.ok(civil.resolved.decisionTrace.boundaryDistances.nextJieBoundaryMs > 0);

  const artifacts = buildNatalCalendarArtifacts({
    version: 'bazi.natal_calendar_artifacts_request.v1',
    inputFactHash: `sha256:${'1'.repeat(64)}`,
    subjectRef: 'subject:example',
    validTimeRef: 'time:natal',
    traditionalSexClass: 'male',
    precisionPolicy: { mode: 'retain_all' },
    resolutions: [civil, solar],
  });
  const set = artifacts.candidateSnapshotSet;
  assert.equal(set.candidates.length, 2);
  assert.deepEqual(set.candidates[0].snapshot.pillars, set.candidates[1].snapshot.pillars);
  assert.notEqual(set.candidates[0].candidateId, set.candidates[1].candidateId);
  assert.equal(set.candidates[0].snapshot.traditionalSexClass, 'male');
  assert.equal(artifacts.calendarDecisionTrace.candidatePaths.length, 2);
  assert.equal(
    artifacts.calendarResolutionEnvelope.candidateSnapshotSetHash,
    set.candidateSnapshotSetHash,
  );
});

test('candidate snapshot request fails closed on untraced or malformed inputs', () => {
  const valid = {
    version: 'bazi.natal_calendar_artifacts_request.v1',
    inputFactHash: `sha256:${'1'.repeat(64)}`,
    subjectRef: 'subject:test',
    validTimeRef: 'time:test',
    traditionalSexClass: 'unknown',
    precisionPolicy: { mode: 'retain_all' },
    resolutions: [{}],
  };
  assert.throws(() => buildNatalCalendarArtifacts({ ...valid, version: 'v0' }), /version is unsupported/);
  assert.throws(() => buildNatalCalendarArtifacts({ ...valid, traditionalSexClass: 'other' }), /male, female or unknown/);
  assert.deepEqual(buildNatalCalendarArtifacts({ ...valid, resolutions: [] }).candidateSnapshotSet.candidates, []);
  assert.throws(() => buildNatalCalendarArtifacts(valid), /traced instant calendar resolution/);
});
