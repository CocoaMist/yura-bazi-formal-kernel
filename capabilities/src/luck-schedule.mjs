/**
 * Named luck-schedule builders.
 * Capabilities only. The kernel never selects 起运 or 小运.
 * Each profile is an explicit candidate algorithm, not a silent default.
 */
import { BRANCHES, STEMS } from './profile.mjs';
import {
  assertNonEmptyString,
  canonicalInstant,
  captureRecord,
  deepFreeze,
  domainHash,
  fail,
  instantMs,
} from './shared.mjs';

export const MAJOR_LUCK_PROFILE_ID =
  'bazi.luck_schedule.major.jieqi_fold_3day_mean_year.yang_male_yin_female_from_month.v1';
export const MINOR_LUCK_PROFILE_ID =
  'bazi.luck_schedule.minor.hour_step_one_mean_year.yang_male_yin_female.xingpinghuihai_quoted.v1';
export const LUCK_SCHEDULE_BUNDLE_VERSION = 'bazi.named_luck_schedule_bundle.v1';

const MEAN_YEAR_MS = 365.2425 * 86_400_000;
const THREE_DAY_MS = 3 * 86_400_000;
const FOLD = MEAN_YEAR_MS / THREE_DAY_MS;
const MAJOR_STEP_MS = 10 * MEAN_YEAR_MS;
const MINOR_STEP_MS = MEAN_YEAR_MS;
const MAJOR_STEP_COUNT = 12;
const MINOR_STEP_COUNT = 110;
const YANG_STEMS = new Set(['jia', 'bing', 'wu', 'geng', 'ren']);

const MAJOR_SOURCE_REFS = Object.freeze([
  'library:book:purchased-20260831:三命通会-明-万民英:论大运:jieqi-zhechu',
  'library:book:purchased-20260831:命理探源--袁树珊:推大运:三日为一岁',
]);
const MINOR_SOURCE_REFS = Object.freeze([
  'library:book:purchased-20260831:命理探源--袁树珊:星平会海:小运之法本由时',
  'library:book:purchased-20260831:五行精纪-宋-廖中:competing-minor-luck-methods',
]);

function capturePillar(value, label) {
  const source = captureRecord(value, label, ['stemId', 'branchId']);
  const stemIndex = STEMS.indexOf(source.stemId);
  const branchIndex = BRANCHES.indexOf(source.branchId);
  if (stemIndex < 0 || branchIndex < 0 || stemIndex % 2 !== branchIndex % 2) {
    fail(`${label} must be a sexagenary pillar`);
  }
  return { stemId: source.stemId, branchId: source.branchId };
}

function sexagenaryIndexOf(pillar) {
  for (let index = 0; index < 60; index += 1) {
    if (STEMS[index % 10] === pillar.stemId && BRANCHES[index % 12] === pillar.branchId) {
      return index;
    }
  }
  fail('pillar is not a sexagenary pair');
}

function pillarFromIndex(index) {
  const wrapped = ((index % 60) + 60) % 60;
  return { stemId: STEMS[wrapped % 10], branchId: BRANCHES[wrapped % 12] };
}

function stepPillar(pillar, delta) {
  return pillarFromIndex(sexagenaryIndexOf(pillar) + delta);
}

export function luckDirectionOf(traditionalSexClass, yearStemId) {
  if (!STEMS.includes(yearStemId)) fail('yearStemId is unsupported');
  const yangYear = YANG_STEMS.has(yearStemId);
  if (traditionalSexClass === 'male') return yangYear ? 1 : -1;
  if (traditionalSexClass === 'female') return yangYear ? -1 : 1;
  fail('traditionalSexClass unknown cannot select a luck direction');
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function segment(segmentId, pillar, validFromMs, validUntilMs, refs) {
  if (!(validFromMs < validUntilMs)) fail(`${segmentId} must have positive duration`);
  return {
    segmentId,
    pillar,
    validFrom: iso(validFromMs),
    validUntil: iso(validUntilMs),
    termRef: refs.termRef,
    sourceRefs: [...refs.sourceRefs],
    authorityRef: refs.authorityRef,
    calculationProfileRef: refs.calculationProfileRef,
    calendarBasisRef: refs.calendarBasisRef,
    boundaryProfileRef: refs.boundaryProfileRef,
    locationTimeRef: refs.locationTimeRef,
    inputDependencyRefs: [...refs.inputDependencyRefs],
    decisionRefs: [...refs.decisionRefs, `segment:${segmentId}`],
  };
}

export function centuryScheduleOf(schedule) {
  return schedule.map((row) => {
    const { validFromMs, validUntilMs, ...rest } = row;
    return rest;
  });
}

export function scheduleAt(schedule, atMs, label) {
  const matches = schedule.filter((row) => row.validFromMs <= atMs && atMs < row.validUntilMs);
  if (matches.length !== 1) fail(`${label} must match exactly one schedule segment`);
  return matches[0];
}

function attachMs(rows) {
  return rows.map((row) => ({
    ...row,
    validFromMs: instantMs(row.validFrom, `${row.segmentId}.validFrom`),
    validUntilMs: instantMs(row.validUntil, `${row.segmentId}.validUntil`),
  }));
}

export function buildNamedLuckSchedulesV1(value) {
  const source = captureRecord(value, 'luckScheduleRequest', [
    'version', 'subjectRef', 'snapshotRef', 'traditionalSexClass',
    'yearStemId', 'monthPillar', 'hourPillar', 'birthInstant',
    'previousJieInstant', 'nextJieInstant', 'calendarBasisRef',
    'boundaryProfileRef', 'locationTimeRef', 'authorityRef',
    'majorLuckProfileId', 'minorLuckProfileId', 'inputDependencyRefs',
  ]);
  if (source.version !== LUCK_SCHEDULE_BUNDLE_VERSION) {
    fail('luckScheduleRequest.version is unsupported');
  }
  if (source.majorLuckProfileId !== MAJOR_LUCK_PROFILE_ID) {
    fail('majorLuckProfileId is not an implemented named profile');
  }
  if (source.minorLuckProfileId !== MINOR_LUCK_PROFILE_ID) {
    fail('minorLuckProfileId is not an implemented named profile');
  }
  if (!Array.isArray(source.inputDependencyRefs)
    || source.inputDependencyRefs.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail('luckScheduleRequest.inputDependencyRefs must be non-empty strings');
  }
  const monthPillar = capturePillar(source.monthPillar, 'luckScheduleRequest.monthPillar');
  const hourPillar = capturePillar(source.hourPillar, 'luckScheduleRequest.hourPillar');
  const yearStemId = assertNonEmptyString(source.yearStemId, 'luckScheduleRequest.yearStemId');
  if (!STEMS.includes(yearStemId)) fail('luckScheduleRequest.yearStemId is unsupported');
  const direction = luckDirectionOf(source.traditionalSexClass, yearStemId);
  const birthMs = instantMs(source.birthInstant, 'luckScheduleRequest.birthInstant');
  const previousJieMs = instantMs(source.previousJieInstant, 'luckScheduleRequest.previousJieInstant');
  const nextJieMs = instantMs(source.nextJieInstant, 'luckScheduleRequest.nextJieInstant');
  if (!(previousJieMs < birthMs && birthMs < nextJieMs)) {
    fail('birthInstant must lie strictly between previous and next jie instants');
  }
  const jieDeltaMs = direction > 0 ? nextJieMs - birthMs : birthMs - previousJieMs;
  if (!(jieDeltaMs > 0)) fail('jieqi distance must be positive');
  const luckStartMs = birthMs + Math.round(jieDeltaMs * FOLD);
  if (!(luckStartMs > birthMs)) fail('folded 起运 instant must be after birth');

  const common = {
    authorityRef: assertNonEmptyString(source.authorityRef, 'luckScheduleRequest.authorityRef'),
    calendarBasisRef: assertNonEmptyString(
      source.calendarBasisRef,
      'luckScheduleRequest.calendarBasisRef',
    ),
    boundaryProfileRef: assertNonEmptyString(
      source.boundaryProfileRef,
      'luckScheduleRequest.boundaryProfileRef',
    ),
    locationTimeRef: assertNonEmptyString(
      source.locationTimeRef,
      'luckScheduleRequest.locationTimeRef',
    ),
    inputDependencyRefs: [...source.inputDependencyRefs],
    decisionRefs: [
      `luck-direction:${direction > 0 ? 'forward' : 'reverse'}`,
      `year-stem:${yearStemId}`,
      `sex:${source.traditionalSexClass}`,
      `jie-delta-ms:${jieDeltaMs}`,
      `fold:${FOLD}`,
      `luck-start:${iso(luckStartMs)}`,
    ],
  };

  const majorRefs = {
    ...common,
    termRef: 'term:major_luck:sanmingtonghui-yichen-shinian',
    sourceRefs: MAJOR_SOURCE_REFS,
    calculationProfileRef: MAJOR_LUCK_PROFILE_ID,
  };
  const minorRefs = {
    ...common,
    termRef: 'term:minor_luck:xingpinghuihai-from-hour-one-year',
    sourceRefs: MINOR_SOURCE_REFS,
    calculationProfileRef: MINOR_LUCK_PROFILE_ID,
  };

  const majorLuckSchedule = [
    segment('major:pre-month-command', monthPillar, birthMs, luckStartMs, {
      ...majorRefs,
      termRef: 'term:major_luck:pre_start_month_as_source',
      decisionRefs: [...majorRefs.decisionRefs, 'pre-start:month-pillar'],
    }),
    ...Array.from({ length: MAJOR_STEP_COUNT }, (_, index) => segment(
      `major:step-${String(index).padStart(2, '0')}`,
      stepPillar(monthPillar, direction * (index + 1)),
      luckStartMs + index * MAJOR_STEP_MS,
      luckStartMs + (index + 1) * MAJOR_STEP_MS,
      majorRefs,
    )),
  ];
  const minorLuckSchedule = Array.from({ length: MINOR_STEP_COUNT }, (_, index) => segment(
    `minor:step-${String(index).padStart(2, '0')}`,
    stepPillar(hourPillar, direction * (index + 1)),
    birthMs + index * MINOR_STEP_MS,
    birthMs + (index + 1) * MINOR_STEP_MS,
    minorRefs,
  ));

  const body = {
    version: LUCK_SCHEDULE_BUNDLE_VERSION,
    subjectRef: assertNonEmptyString(source.subjectRef, 'luckScheduleRequest.subjectRef'),
    snapshotRef: assertNonEmptyString(source.snapshotRef, 'luckScheduleRequest.snapshotRef'),
    traditionalSexClass: source.traditionalSexClass,
    yearStemId,
    monthPillar,
    hourPillar,
    direction: direction > 0 ? 'forward' : 'reverse',
    directionSign: direction,
    birthInstant: canonicalInstant(source.birthInstant, 'luckScheduleRequest.birthInstant'),
    previousJieInstant: canonicalInstant(
      source.previousJieInstant,
      'luckScheduleRequest.previousJieInstant',
    ),
    nextJieInstant: canonicalInstant(source.nextJieInstant, 'luckScheduleRequest.nextJieInstant'),
    jieDeltaMs,
    fold: FOLD,
    luckStartInstant: iso(luckStartMs),
    luckStartMs,
    meanYearMs: MEAN_YEAR_MS,
    majorLuckProfileId: MAJOR_LUCK_PROFILE_ID,
    minorLuckProfileId: MINOR_LUCK_PROFILE_ID,
    competingMinorMethodsNotSelected: true,
    judgmentStatus: 'not_evaluated',
    causalStatus: 'not_modeled',
    effectEligible: false,
    majorLuckSchedule,
    minorLuckSchedule,
  };
  const withMs = {
    ...body,
    majorLuckSchedule: attachMs(majorLuckSchedule),
    minorLuckSchedule: attachMs(minorLuckSchedule),
  };
  return deepFreeze({
    ...withMs,
    bundleHash: domainHash('bazi.named_luck_schedule_bundle.v1', body),
  });
}

function calendarLayer(layerId, pillar, resolution, boundaryProfileId, timeZoneId) {
  const occurrence = `time.${layerId}:${resolution.resolutionHash}`;
  const atMs = resolution.resolved.atMs;
  const trace = resolution.resolved.decisionTrace;
  return {
    layerId,
    pillarOccurrenceId: occurrence,
    stemOccurrenceId: `${occurrence}.stem`,
    branchOccurrenceId: `${occurrence}.branch`,
    subjectRef: null,
    stemId: pillar.stemId,
    branchId: pillar.branchId,
    validFromMs: atMs,
    validUntilMs: atMs + 1,
    termRef: `calendar-layer:${layerId}:resolved-instant`,
    sourceTimeRef: `calendar-resolution:${resolution.resolutionHash}`,
    sourceRefs: resolution.provider.sourceRefs,
    authorityRef: `${resolution.provider.providerId}@${resolution.provider.version}`,
    calculationProfileRef: `calendar-resolution:${resolution.resolutionHash}`,
    calendarBasisRef: 'calendar:gregorian',
    boundaryProfileRef: boundaryProfileId,
    locationTimeRef: `timezone:${timeZoneId}`,
    inputDependencyRefs: [resolution.request.requestHash],
    decisionRefs: trace == null
      ? [`calendar-resolution:${resolution.resolutionHash}`]
      : [
        `calendar-decision-trace:${trace.requestHash}`,
        `calendar-year-boundary:${trace.decisions.yearBoundary}`,
        `calendar-month-boundary:${trace.decisions.monthBoundary}`,
        `calendar-day-boundary:${trace.decisions.dayBoundary}`,
        `calendar-hour-boundary:${trace.decisions.ziHourRule}`,
      ],
  };
}

function scheduleLayer(row, subjectRef) {
  const occurrence = `time.${row.layerId ?? (row.segmentId.startsWith('major') ? 'major_luck' : 'minor_luck')}:${row.segmentId}`;
  const layerId = row.segmentId.startsWith('major') ? 'major_luck' : 'minor_luck';
  return {
    layerId,
    pillarOccurrenceId: occurrence,
    stemOccurrenceId: `${occurrence}.stem`,
    branchOccurrenceId: `${occurrence}.branch`,
    subjectRef,
    stemId: row.pillar.stemId,
    branchId: row.pillar.branchId,
    validFromMs: row.validFromMs,
    validUntilMs: row.validUntilMs,
    termRef: row.termRef,
    sourceTimeRef: `schedule-segment:${row.segmentId}`,
    sourceRefs: row.sourceRefs,
    authorityRef: row.authorityRef,
    calculationProfileRef: row.calculationProfileRef,
    calendarBasisRef: row.calendarBasisRef,
    boundaryProfileRef: row.boundaryProfileRef,
    locationTimeRef: row.locationTimeRef,
    inputDependencyRefs: row.inputDependencyRefs,
    decisionRefs: row.decisionRefs,
  };
}

export function assembleSixLayerCandidateV1({
  subjectRef,
  resolution,
  majorSegment,
  minorSegment,
  boundaryProfileId,
  timeZoneId,
  provenanceRefs,
}) {
  const layers = [
    scheduleLayer(majorSegment, subjectRef),
    scheduleLayer(minorSegment, subjectRef),
    ...['year', 'month', 'day', 'hour'].map((layerId) => calendarLayer(
      layerId,
      resolution.resolved.layers[layerId],
      resolution,
      boundaryProfileId,
      timeZoneId,
    )),
  ];
  return deepFreeze({
    version: 'bazi.temporal_layer_candidate.v1',
    subjectRef,
    targetInstantMs: resolution.resolved.atMs,
    targetTimeRef: `calendar-resolution:${resolution.resolutionHash}`,
    layers,
    provenanceRefs: [...provenanceRefs],
  });
}
