import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTURY_ANNIVERSARY_PROFILE_ID,
  CENTURY_TEMPORAL_PLAN_VERSION,
  LUCK_SCHEDULE_BUNDLE_VERSION,
  MAJOR_LUCK_PROFILE_ID,
  MINOR_LUCK_PROFILE_ID,
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  assembleSixLayerCandidateV1,
  buildNamedLuckSchedulesV1,
  captureCenturyTemporalPlanV1,
  centuryScheduleOf,
  luckDirectionOf,
  resolveTimeRequest,
  scheduleAt,
} from '../src/index.mjs';

const LOCATION = { longitude: 116.4074, latitude: 39.9042, label: 'Beijing' };

function request(local, solarTime = { mode: 'civil' }) {
  return {
    version: 'bazi.time_request.v1',
    mode: 'instant',
    calendar: 'gregorian',
    timeZoneId: 'Asia/Shanghai',
    location: LOCATION,
    solarTime,
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    input: { local },
  };
}

function scheduleInput(resolution, overrides = {}) {
  const trace = resolution.resolved.decisionTrace;
  return {
    version: LUCK_SCHEDULE_BUNDLE_VERSION,
    subjectRef: 'subject:2000-07-19-beijing-male',
    snapshotRef: 'snapshot:test-luck',
    traditionalSexClass: 'male',
    yearStemId: 'geng',
    monthPillar: { stemId: 'gui', branchId: 'wei' },
    hourPillar: { stemId: 'geng', branchId: 'shen' },
    birthInstant: resolution.resolved.at,
    previousJieInstant: trace.decisions.previousJieInstant,
    nextJieInstant: trace.decisions.nextJieInstant,
    calendarBasisRef: 'calendar:gregorian',
    boundaryProfileRef: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    locationTimeRef: 'timezone:Asia/Shanghai',
    authorityRef: 'capability:named-luck-schedule.v1',
    majorLuckProfileId: MAJOR_LUCK_PROFILE_ID,
    minorLuckProfileId: MINOR_LUCK_PROFILE_ID,
    inputDependencyRefs: [resolution.request.requestHash],
    ...overrides,
  };
}

test('yang male goes forward, yin male reverse, unknown sex fails closed', () => {
  assert.equal(luckDirectionOf('male', 'geng'), 1);
  assert.equal(luckDirectionOf('female', 'geng'), -1);
  assert.equal(luckDirectionOf('male', 'gui'), -1);
  assert.equal(luckDirectionOf('female', 'gui'), 1);
  assert.throws(() => luckDirectionOf('unknown', 'geng'), /cannot select a luck direction/);
});

function assertHalfOpenCoverage(schedule, label) {
  for (let index = 1; index < schedule.length; index += 1) {
    assert.equal(
      schedule[index - 1].validUntilMs,
      schedule[index].validFromMs,
      `${label} must be contiguous at ${schedule[index].segmentId}`,
    );
  }
}

test('named jieqi 大运 and hour-step 小运 cover the 2000 Beijing male anniversary in 2030', async () => {
  const birth = await resolveTimeRequest(request('2000-07-19T15:59:00'), REFERENCE_CALENDAR_PROVIDER);
  const schedules = buildNamedLuckSchedulesV1(scheduleInput(birth));
  assert.equal(schedules.direction, 'forward');
  assert.deepEqual(schedules.majorLuckSchedule[0].pillar, { stemId: 'gui', branchId: 'wei' });
  assert.deepEqual(schedules.majorLuckSchedule[1].pillar, { stemId: 'jia', branchId: 'shen' });
  assert.deepEqual(schedules.minorLuckSchedule[0].pillar, { stemId: 'xin', branchId: 'you' });
  assert.ok(schedules.luckStartMs > birth.resolved.atMs);
  assert.equal(schedules.competingMinorMethodsNotSelected, true);
  assert.equal(schedules.effectEligible, false);
  assert.equal(schedules.judgmentStatus, 'not_evaluated');
  assertHalfOpenCoverage(schedules.majorLuckSchedule, 'majorLuckSchedule');
  assertHalfOpenCoverage(schedules.minorLuckSchedule, 'minorLuckSchedule');

  const age0Major = scheduleAt(schedules.majorLuckSchedule, birth.resolved.atMs, 'major_luck');
  const age0Minor = scheduleAt(schedules.minorLuckSchedule, birth.resolved.atMs, 'minor_luck');
  assert.equal(age0Major.segmentId, 'major:pre-month-command');
  assert.equal(age0Minor.segmentId, 'minor:step-00');

  const age30 = await resolveTimeRequest(request('2030-07-19T15:59:00'), REFERENCE_CALENDAR_PROVIDER);
  const major = scheduleAt(schedules.majorLuckSchedule, age30.resolved.atMs, 'major_luck');
  const minor = scheduleAt(schedules.minorLuckSchedule, age30.resolved.atMs, 'minor_luck');
  assert.deepEqual(major.pillar, { stemId: 'bing', branchId: 'xu' });
  assert.match(minor.segmentId, /^minor:step-\d{2}$/);
  assert.deepEqual(age30.resolved.layers.year, { stemId: 'geng', branchId: 'xu' });
  assert.deepEqual(age30.resolved.layers.month, { stemId: 'gui', branchId: 'wei' });

  const age100 = await resolveTimeRequest(request('2100-07-19T15:59:00'), REFERENCE_CALENDAR_PROVIDER);
  scheduleAt(schedules.majorLuckSchedule, age100.resolved.atMs, 'major_luck');
  scheduleAt(schedules.minorLuckSchedule, age100.resolved.atMs, 'minor_luck');

  const candidate = assembleSixLayerCandidateV1({
    subjectRef: schedules.subjectRef,
    resolution: age30,
    majorSegment: major,
    minorSegment: minor,
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    timeZoneId: 'Asia/Shanghai',
    provenanceRefs: [`luck-schedule:${schedules.bundleHash}`],
  });
  assert.deepEqual(
    candidate.layers.map((layer) => layer.layerId),
    ['major_luck', 'minor_luck', 'year', 'month', 'day', 'hour'],
  );
  assert.equal(candidate.layers[0].subjectRef, schedules.subjectRef);
  assert.equal(candidate.layers[2].subjectRef, null);
  assert.equal(candidate.layers[3].stemId, 'gui');
  assert.equal(candidate.layers[3].branchId, 'wei');

  const capturedPlan = captureCenturyTemporalPlanV1({
    version: CENTURY_TEMPORAL_PLAN_VERSION,
    subjectRef: schedules.subjectRef,
    snapshotRef: schedules.snapshotRef,
    birthLocal: '2000-07-19T15:59:00',
    ageFrom: 0,
    ageThrough: 100,
    anniversaryProfileId: CENTURY_ANNIVERSARY_PROFILE_ID,
    calendarContext: {
      timeZoneId: 'Asia/Shanghai',
      location: LOCATION,
      solarTime: { mode: 'civil' },
      boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    },
    majorLuckSchedule: centuryScheduleOf(schedules.majorLuckSchedule),
    minorLuckSchedule: centuryScheduleOf(schedules.minorLuckSchedule),
    provenance: { source: 'named-luck-schedule-test' },
  });
  assert.equal(Object.hasOwn(centuryScheduleOf(schedules.majorLuckSchedule)[0], 'validFromMs'), false);
  assert.match(capturedPlan.planHash, /^sha256:[0-9a-f]{64}$/);
});

test('named luck profiles refuse a silent substitute algorithm', async () => {
  const birth = await resolveTimeRequest(request('2000-07-19T15:59:00'), REFERENCE_CALENDAR_PROVIDER);
  assert.throws(() => buildNamedLuckSchedulesV1(scheduleInput(birth, {
    majorLuckProfileId: 'bazi.luck_schedule.major.not-implemented.v1',
  })), /not an implemented named profile/);
  assert.throws(() => buildNamedLuckSchedulesV1(scheduleInput(birth, {
    minorLuckProfileId: 'bazi.luck_schedule.minor.not-implemented.v1',
  })), /not an implemented named profile/);
  assert.throws(() => buildNamedLuckSchedulesV1(scheduleInput(birth, {
    traditionalSexClass: 'unknown',
  })), /cannot select a luck direction/);
});
