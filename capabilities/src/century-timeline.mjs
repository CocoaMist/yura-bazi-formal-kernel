import { resolveTimeRequest } from './calendar.mjs';
import { BRANCHES, SIX_LAYER_TEMPORAL_IDS, STEMS } from './profile.mjs';
import {
  assertNonEmptyString,
  canonicalInstant,
  captureJson,
  captureRecord,
  contentHash,
  deepFreeze,
  domainHash,
  fail,
  instantMs,
} from './shared.mjs';

export const CENTURY_TEMPORAL_PLAN_VERSION = 'bazi.century_temporal_plan.v1';
export const CENTURY_TEMPORAL_GENERATION_VERSION = 'bazi.century_temporal_generation.v1';
export const CENTURY_ANNIVERSARY_PROFILE_ID =
  'bazi.age_sampling.gregorian_local_anniversary_feb28.v1';

const AGE_FROM = 0;
const AGE_THROUGH = 100;

function captureStringList(value, label, allowEmpty = true) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = captureJson(value, label).map(
    (item, index) => assertNonEmptyString(item, `${label}[${index}]`),
  );
  if (!allowEmpty && result.length === 0) fail(`${label} must not be empty`);
  return result;
}

function capturePillar(value, label) {
  const source = captureRecord(value, label, ['stemId', 'branchId']);
  const stemIndex = STEMS.indexOf(source.stemId);
  const branchIndex = BRANCHES.indexOf(source.branchId);
  if (stemIndex < 0 || branchIndex < 0 || stemIndex % 2 !== branchIndex % 2) {
    fail(`${label} must be a sexagenary pillar`);
  }
  return { stemId: source.stemId, branchId: source.branchId };
}

function captureScheduleSegment(value, index, layerId) {
  const label = `centuryPlan.${layerId}Schedule[${index}]`;
  const source = captureRecord(value, label, [
    'segmentId', 'pillar', 'validFrom', 'validUntil', 'termRef', 'sourceRefs',
    'authorityRef', 'calculationProfileRef', 'calendarBasisRef',
    'boundaryProfileRef', 'locationTimeRef', 'inputDependencyRefs', 'decisionRefs',
  ]);
  const validFromMs = instantMs(source.validFrom, `${label}.validFrom`);
  const validUntilMs = instantMs(source.validUntil, `${label}.validUntil`);
  if (validFromMs >= validUntilMs) fail(`${label} must have positive duration`);
  return {
    layerId,
    segmentId: assertNonEmptyString(source.segmentId, `${label}.segmentId`),
    pillar: capturePillar(source.pillar, `${label}.pillar`),
    validFrom: canonicalInstant(source.validFrom, `${label}.validFrom`),
    validUntil: canonicalInstant(source.validUntil, `${label}.validUntil`),
    validFromMs,
    validUntilMs,
    termRef: assertNonEmptyString(source.termRef, `${label}.termRef`),
    sourceRefs: captureStringList(source.sourceRefs, `${label}.sourceRefs`, false),
    authorityRef: assertNonEmptyString(source.authorityRef, `${label}.authorityRef`),
    calculationProfileRef: assertNonEmptyString(
      source.calculationProfileRef,
      `${label}.calculationProfileRef`,
    ),
    calendarBasisRef: assertNonEmptyString(
      source.calendarBasisRef,
      `${label}.calendarBasisRef`,
    ),
    boundaryProfileRef: assertNonEmptyString(
      source.boundaryProfileRef,
      `${label}.boundaryProfileRef`,
    ),
    locationTimeRef: assertNonEmptyString(
      source.locationTimeRef,
      `${label}.locationTimeRef`,
    ),
    inputDependencyRefs: captureStringList(
      source.inputDependencyRefs,
      `${label}.inputDependencyRefs`,
    ),
    decisionRefs: captureStringList(source.decisionRefs, `${label}.decisionRefs`),
  };
}

function captureSchedule(value, layerId) {
  const label = `centuryPlan.${layerId}Schedule`;
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array`);
  const segments = value.map((segment, index) => captureScheduleSegment(segment, index, layerId));
  const ids = new Set();
  segments.sort((left, right) => left.validFromMs - right.validFromMs
    || (left.segmentId < right.segmentId ? -1 : left.segmentId > right.segmentId ? 1 : 0));
  for (let index = 0; index < segments.length; index += 1) {
    if (ids.has(segments[index].segmentId)) fail(`${label} segmentId values must be unique`);
    ids.add(segments[index].segmentId);
    if (index > 0 && segments[index - 1].validUntilMs > segments[index].validFromMs) {
      fail(`${label} must not contain overlapping segments`);
    }
  }
  return segments;
}

function captureLocalBirth(value) {
  const birthLocal = assertNonEmptyString(value, 'centuryPlan.birthLocal');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(birthLocal);
  if (!match) fail('centuryPlan.birthLocal must be YYYY-MM-DDTHH:mm:ss[.sss] without offset');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month
    || check.getUTCDate() !== day || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second
    || check.getUTCMilliseconds() !== millisecond) {
    fail('centuryPlan.birthLocal must be a real Gregorian local date-time');
  }
  return { birthLocal, year, month, day, hour, minute, second, millisecond };
}

function captureCalendarContext(value) {
  const source = captureRecord(value, 'centuryPlan.calendarContext', [
    'timeZoneId', 'solarTime', 'boundaryProfileId',
  ], ['location']);
  return {
    timeZoneId: assertNonEmptyString(source.timeZoneId, 'centuryPlan.calendarContext.timeZoneId'),
    ...(Object.hasOwn(source, 'location')
      ? { location: captureJson(source.location, 'centuryPlan.calendarContext.location') }
      : {}),
    solarTime: captureJson(source.solarTime, 'centuryPlan.calendarContext.solarTime'),
    boundaryProfileId: assertNonEmptyString(
      source.boundaryProfileId,
      'centuryPlan.calendarContext.boundaryProfileId',
    ),
  };
}

export function captureCenturyTemporalPlanV1(value) {
  const source = captureRecord(value, 'centuryPlan', [
    'version', 'subjectRef', 'snapshotRef', 'birthLocal', 'ageFrom', 'ageThrough',
    'anniversaryProfileId', 'calendarContext', 'majorLuckSchedule',
    'minorLuckSchedule', 'provenance',
  ]);
  if (source.version !== CENTURY_TEMPORAL_PLAN_VERSION) {
    fail('centuryPlan.version is unsupported');
  }
  if (source.ageFrom !== AGE_FROM || source.ageThrough !== AGE_THROUGH) {
    fail('centuryPlan age range must be exactly 0 through 100 inclusive');
  }
  if (source.anniversaryProfileId !== CENTURY_ANNIVERSARY_PROFILE_ID) {
    fail('centuryPlan.anniversaryProfileId is unsupported');
  }
  const birth = captureLocalBirth(source.birthLocal);
  const body = {
    version: source.version,
    subjectRef: assertNonEmptyString(source.subjectRef, 'centuryPlan.subjectRef'),
    snapshotRef: assertNonEmptyString(source.snapshotRef, 'centuryPlan.snapshotRef'),
    birthLocal: birth.birthLocal,
    birthParts: {
      year: birth.year,
      month: birth.month,
      day: birth.day,
      hour: birth.hour,
      minute: birth.minute,
      second: birth.second,
      millisecond: birth.millisecond,
    },
    ageFrom: source.ageFrom,
    ageThrough: source.ageThrough,
    anniversaryProfileId: source.anniversaryProfileId,
    calendarContext: captureCalendarContext(source.calendarContext),
    majorLuckSchedule: captureSchedule(source.majorLuckSchedule, 'major_luck'),
    minorLuckSchedule: captureSchedule(source.minorLuckSchedule, 'minor_luck'),
    provenance: captureJson(source.provenance, 'centuryPlan.provenance'),
  };
  return deepFreeze({ ...body, planHash: domainHash('bazi.century_temporal_plan.v1', body) });
}

function localAnniversary(plan, age) {
  const parts = plan.birthParts;
  const year = parts.year + age;
  const leapDay = parts.month === 2 && parts.day === 29;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const day = leapDay && !isLeapYear ? 28 : parts.day;
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(parts.month)}-${pad(day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(parts.millisecond, 3)}`;
}

function scheduleAt(schedule, atMs, label) {
  const matches = schedule.filter((segment) => (
    segment.validFromMs <= atMs && atMs < segment.validUntilMs
  ));
  if (matches.length !== 1) fail(`${label} must match exactly one schedule segment`);
  return matches[0];
}

function scheduleLayer(segment, plan) {
  const occurrence = `time.${segment.layerId}:${segment.segmentId}`;
  return {
    layerId: segment.layerId,
    pillarOccurrenceId: occurrence,
    stemOccurrenceId: `${occurrence}.stem`,
    branchOccurrenceId: `${occurrence}.branch`,
    subjectRef: plan.subjectRef,
    stemId: segment.pillar.stemId,
    branchId: segment.pillar.branchId,
    validFromMs: segment.validFromMs,
    validUntilMs: segment.validUntilMs,
    termRef: segment.termRef,
    sourceTimeRef: `schedule-segment:${segment.segmentId}`,
    sourceRefs: segment.sourceRefs,
    authorityRef: segment.authorityRef,
    calculationProfileRef: segment.calculationProfileRef,
    calendarBasisRef: segment.calendarBasisRef,
    boundaryProfileRef: segment.boundaryProfileRef,
    locationTimeRef: segment.locationTimeRef,
    inputDependencyRefs: segment.inputDependencyRefs,
    decisionRefs: segment.decisionRefs,
  };
}

function calendarLayer(layerId, pillar, resolution, plan, age) {
  const occurrence = `time.${layerId}:age-${age}:${resolution.resolutionHash}`;
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
    boundaryProfileRef: plan.calendarContext.boundaryProfileId,
    locationTimeRef: `timezone:${plan.calendarContext.timeZoneId}`,
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

function stableFailure(age, localAt, error) {
  const deterministic = error instanceof TypeError || error instanceof RangeError;
  const stableErrorCode = deterministic
    ? 'bazi.century_temporal_generation.age_resolution.domain_error'
    : 'bazi.century_temporal_generation.age_resolution.runtime_error';
  const body = {
    version: 'bazi.century_temporal_generation_result.v1',
    age,
    localAt,
    status: 'generation_failed',
    stableErrorCode,
    deterministic,
    retryable: !deterministic,
  };
  return deepFreeze({
    ...body,
    resultHash: domainHash('bazi.century_temporal_generation_result.v1', body),
    diagnostics: {
      errorName: error?.name ?? 'Error',
      message: error?.message ?? String(error),
    },
  });
}

export async function buildCenturyTemporalCandidatesV1(planValue, provider) {
  const plan = captureCenturyTemporalPlanV1(planValue);
  const ageResults = [];
  const candidates = [];
  for (let age = AGE_FROM; age <= AGE_THROUGH; age += 1) {
    const localAt = localAnniversary(plan, age);
    try {
      const resolution = await resolveTimeRequest({
        version: 'bazi.time_request.v1',
        mode: 'instant',
        calendar: 'gregorian',
        timeZoneId: plan.calendarContext.timeZoneId,
        ...(plan.calendarContext.location == null ? {} : { location: plan.calendarContext.location }),
        solarTime: plan.calendarContext.solarTime,
        boundaryProfileId: plan.calendarContext.boundaryProfileId,
        input: { local: localAt },
      }, provider);
      const majorLuck = scheduleAt(plan.majorLuckSchedule, resolution.resolved.atMs, 'major_luck');
      const minorLuck = scheduleAt(plan.minorLuckSchedule, resolution.resolved.atMs, 'minor_luck');
      const temporalCandidateId = `age:${age}:calendar:${resolution.resolutionHash}`;
      const layers = [
        scheduleLayer(majorLuck, plan),
        scheduleLayer(minorLuck, plan),
        ...['year', 'month', 'day', 'hour'].map((layerId) => calendarLayer(
          layerId,
          resolution.resolved.layers[layerId],
          resolution,
          plan,
          age,
        )),
      ];
      if (layers.map((layer) => layer.layerId).join('|') !== SIX_LAYER_TEMPORAL_IDS.join('|')) {
        fail('generated temporal layers do not follow the six-layer canonical order');
      }
      const candidate = deepFreeze({
        version: 'bazi.temporal_layer_candidate.v1',
        subjectRef: plan.subjectRef,
        targetInstantMs: resolution.resolved.atMs,
        targetTimeRef: `calendar-resolution:${resolution.resolutionHash}`,
        layers,
        provenanceRefs: [
          `century-plan:${plan.planHash}`,
          `calendar-resolution:${resolution.resolutionHash}`,
          `major-luck-segment:${majorLuck.segmentId}`,
          `minor-luck-segment:${minorLuck.segmentId}`,
        ],
      });
      const candidateOrdinal = candidates.length;
      candidates.push(deepFreeze({
        temporalCandidateId,
        calendarDecisionPathRef: `calendar-path:${resolution.resolutionHash}`,
        candidate,
      }));
      const body = {
        version: 'bazi.century_temporal_generation_result.v1',
        age,
        localAt,
        status: 'generated',
        candidateOrdinal,
        temporalCandidateId,
        calendarResolutionHash: resolution.resolutionHash,
        majorLuckSegmentRef: majorLuck.segmentId,
        minorLuckSegmentRef: minorLuck.segmentId,
      };
      ageResults.push(deepFreeze({
        ...body,
        resultHash: domainHash('bazi.century_temporal_generation_result.v1', body),
      }));
    } catch (error) {
      ageResults.push(stableFailure(age, localAt, error));
    }
  }
  const generatedCount = candidates.length;
  const identity = deepFreeze({
    version: CENTURY_TEMPORAL_GENERATION_VERSION,
    planHash: plan.planHash,
    subjectRef: plan.subjectRef,
    snapshotRef: plan.snapshotRef,
    ageFrom: AGE_FROM,
    ageThrough: AGE_THROUGH,
    inputAgeCount: AGE_THROUGH - AGE_FROM + 1,
    ageResultCount: ageResults.length,
    generatedCount,
    failedCount: ageResults.length - generatedCount,
    candidateCount: candidates.length,
    ageResultHashes: ageResults.map((result) => result.resultHash),
    candidateContentHash: contentHash(candidates),
    judgmentStatus: 'not_evaluated',
    causalStatus: 'not_modeled',
    effectEligible: false,
  });
  if (identity.inputAgeCount !== identity.ageResultCount) {
    throw new Error('century temporal generation total-map invariant violated');
  }
  return deepFreeze({
    ...identity,
    plan,
    candidates,
    ageResults,
    generationHash: domainHash('bazi.century_temporal_generation.v1', identity),
  });
}
