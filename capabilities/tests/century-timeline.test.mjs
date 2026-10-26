import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTURY_ANNIVERSARY_PROFILE_ID,
  CENTURY_TEMPORAL_PLAN_VERSION,
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  buildCenturyTemporalCandidatesV1,
  captureCenturyTemporalPlanV1,
} from '../src/index.mjs';

function segment(segmentId, validFrom, validUntil, stemId, branchId) {
  return {
    segmentId,
    pillar: { stemId, branchId },
    validFrom,
    validUntil,
    termRef: `term:${segmentId}`,
    sourceRefs: [`source:${segmentId}`],
    authorityRef: 'authority:test-explicit-schedule',
    calculationProfileRef: 'calculation:test-explicit-schedule.v1',
    calendarBasisRef: 'calendar:explicit-schedule',
    boundaryProfileRef: 'boundary:test-explicit-schedule.v1',
    locationTimeRef: 'timezone:Asia/Shanghai',
    inputDependencyRefs: ['input:test-explicit-schedule'],
    decisionRefs: ['decision:test-explicit-schedule'],
  };
}

function plan(overrides = {}) {
  return {
    version: CENTURY_TEMPORAL_PLAN_VERSION,
    subjectRef: 'subject:century-test',
    snapshotRef: 'snapshot:century-test',
    birthLocal: '2000-07-19T16:00:00.000',
    ageFrom: 0,
    ageThrough: 100,
    anniversaryProfileId: CENTURY_ANNIVERSARY_PROFILE_ID,
    calendarContext: {
      timeZoneId: 'Asia/Shanghai',
      location: { longitude: 116.4074, latitude: 39.9042, label: 'Beijing' },
      solarTime: { mode: 'civil' },
      boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    },
    majorLuckSchedule: [segment(
      'major:explicit-all',
      '1999-01-01T00:00:00Z',
      '2101-01-01T00:00:00Z',
      'jia',
      'zi',
    )],
    minorLuckSchedule: [segment(
      'minor:explicit-all',
      '1999-01-01T00:00:00Z',
      '2101-01-01T00:00:00Z',
      'yi',
      'chou',
    )],
    provenance: { source: 'test-explicit-not-a-traditional-authority' },
    ...overrides,
  };
}

test('century generator produces one preserved age result for every age from zero through one hundred', async () => {
  const captured = captureCenturyTemporalPlanV1(plan());
  assert.match(captured.planHash, /^sha256:[0-9a-f]{64}$/);
  const result = await buildCenturyTemporalCandidatesV1(plan(), REFERENCE_CALENDAR_PROVIDER);
  assert.equal(result.inputAgeCount, 101);
  assert.equal(result.ageResultCount, 101);
  assert.equal(result.generatedCount, 101);
  assert.equal(result.failedCount, 0);
  assert.equal(result.candidateCount, 101);
  assert.deepEqual([result.ageResults[0].age, result.ageResults.at(-1).age], [0, 100]);
  assert.equal(result.candidates[0].candidate.layers.length, 6);
  assert.deepEqual(
    result.candidates[0].candidate.layers.map((layer) => layer.layerId),
    ['major_luck', 'minor_luck', 'year', 'month', 'day', 'hour'],
  );
  assert.ok(result.candidates.every((candidate) => (
    candidate.candidate.layers[0].subjectRef === result.subjectRef
    && candidate.candidate.layers[1].subjectRef === result.subjectRef
    && candidate.candidate.layers.slice(2).every((layer) => layer.subjectRef === null)
  )));
  assert.equal(result.judgmentStatus, 'not_evaluated');
  assert.equal(result.causalStatus, 'not_modeled');
  assert.equal(result.effectEligible, false);
});

test('century generator retains uncovered ages as explicit generation failures', async () => {
  const limited = plan({
    majorLuckSchedule: [segment(
      'major:limited',
      '1999-01-01T00:00:00Z',
      '2050-01-01T00:00:00Z',
      'jia',
      'zi',
    )],
  });
  const result = await buildCenturyTemporalCandidatesV1(limited, REFERENCE_CALENDAR_PROVIDER);
  assert.equal(result.ageResultCount, 101);
  assert.ok(result.generatedCount > 0 && result.failedCount > 0);
  assert.equal(result.generatedCount + result.failedCount, 101);
  assert.ok(result.ageResults.some((row) => row.status === 'generation_failed'));
  assert.ok(result.ageResults.filter((row) => row.status === 'generation_failed').every((row) => (
    row.deterministic === true && row.retryable === false
  )));
});

test('century plan rejects approximate ranges, overlaps and invalid local dates', () => {
  assert.throws(() => captureCenturyTemporalPlanV1(plan({ ageThrough: 99 })), /exactly 0 through 100/);
  assert.throws(() => captureCenturyTemporalPlanV1(plan({ birthLocal: '2001-02-29T12:00:00' })), /real Gregorian/);
  assert.throws(() => captureCenturyTemporalPlanV1(plan({
    minorLuckSchedule: [
      segment('minor:a', '1999-01-01T00:00:00Z', '2050-01-01T00:00:00Z', 'yi', 'chou'),
      segment('minor:b', '2049-01-01T00:00:00Z', '2101-01-01T00:00:00Z', 'bing', 'yin'),
    ],
  })), /must not contain overlapping/);
});

test('century anniversary profile resolves leap-day births to February 28 in non-leap years', async () => {
  const leap = plan({
    birthLocal: '2000-02-29T12:00:00.000',
    majorLuckSchedule: [segment('major:leap', '1999-01-01T00:00:00Z', '2101-01-01T00:00:00Z', 'jia', 'zi')],
    minorLuckSchedule: [segment('minor:leap', '1999-01-01T00:00:00Z', '2101-01-01T00:00:00Z', 'yi', 'chou')],
  });
  const result = await buildCenturyTemporalCandidatesV1(leap, REFERENCE_CALENDAR_PROVIDER);
  assert.equal(result.ageResults[1].localAt, '2001-02-28T12:00:00.000');
});
