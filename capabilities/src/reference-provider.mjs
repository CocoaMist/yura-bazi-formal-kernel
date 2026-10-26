import { BRANCHES, STEMS } from './profile.mjs';
import { captureRecord, deepFreeze, fail } from './shared.mjs';
import { CALENDAR_DECISION_TRACE_VERSION, PROVENANCE_VERSION } from './contracts.mjs';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DEG = Math.PI / 180;
const BOUNDARY_PROFILE_ID = 'bazi.time_boundaries.jie_midnight_zi_split.v2';
const TRUE_SOLAR_ALGORITHM_ID = 'calendar.true_solar.meeus_approx.integer_ms.v2';
const PROVIDER_ID = 'bazi.reference_calendar.intl_meeus';
const PROVIDER_VERSION = '1.1.0';
const MAX_RANGE_SEGMENTS = 5000;
const normalize = (value, period) => ((value % period) + period) % period;

const runtimeVersions = Object.freeze({
  icu: process.versions.icu ?? 'unknown',
  cldr: process.versions.cldr ?? 'unknown',
  tz: process.versions.tz ?? 'unknown'
});

export const REFERENCE_CALENDAR_SOURCE_REFS = Object.freeze([
  'standard:gbt-33661-2017',
  'standard:iana-tzdb',
  'rfc:9636',
  'book:dershowitz-reingold:calendrical-calculations:chinese-calendar',
  'book:meeus:astronomical-algorithms',
  `runtime:icu:${runtimeVersions.icu}`,
  `runtime:cldr:${runtimeVersions.cldr}`,
  `runtime:tz:${runtimeVersions.tz}`,
  'reference:yuracore:solar-time-and-birth-chart:read-only'
]);

function parseCivil(value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) fail(`${label} must be YYYY-MM-DDTHH:mm:ss[.sss] without an offset`);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day
    || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute
    || check.getUTCSeconds() !== second || check.getUTCMilliseconds() !== millisecond) {
    fail(`${label} must be a real Gregorian local date-time`);
  }
  return { year, month, day, hour, minute, second, millisecond };
}

function parseClock(value, label) {
  return parseCivil(`2000-01-01T${value}`, label);
}

const offsetFormatters = new Map();
const localFormatters = new Map();

function offsetFormatter(timeZoneId) {
  if (!offsetFormatters.has(timeZoneId)) {
    offsetFormatters.set(timeZoneId, new Intl.DateTimeFormat('en-US', {
      timeZone: timeZoneId,
      timeZoneName: 'longOffset',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }));
  }
  return offsetFormatters.get(timeZoneId);
}

function localFormatter(timeZoneId) {
  if (!localFormatters.has(timeZoneId)) {
    localFormatters.set(timeZoneId, new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }));
  }
  return localFormatters.get(timeZoneId);
}

function offsetMinutes(milliseconds, timeZoneId) {
  const parts = offsetFormatter(timeZoneId).formatToParts(new Date(milliseconds));
  const value = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  if (value === 'GMT' || value === 'UTC') return 0;
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(value);
  if (!match) fail(`unsupported time-zone offset format: ${value}`);
  const magnitude = Number(match[2]) * 60 + Number(match[3] ?? 0) + Number(match[4] ?? 0) / 60;
  return match[1] === '-' ? -magnitude : magnitude;
}

function localParts(milliseconds, timeZoneId) {
  const parts = localFormatter(timeZoneId).formatToParts(new Date(milliseconds));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return { ...values, millisecond: new Date(milliseconds).getUTCMilliseconds() };
}

function localToInstant(civil, timeZoneId, selectedOffset = null) {
  if (selectedOffset !== null && (!Number.isFinite(selectedOffset) || Math.abs(selectedOffset) > 14 * 60)) {
    fail('utcOffsetMinutes must be finite within fourteen hours');
  }
  const wall = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second, civil.millisecond);
  let estimate = wall;
  for (let index = 0; index < 4; index += 1) estimate = wall - offsetMinutes(estimate, timeZoneId) * MINUTE_MS;
  const offsets = new Set([
    offsetMinutes(estimate - 3 * 60 * MINUTE_MS, timeZoneId),
    offsetMinutes(estimate, timeZoneId),
    offsetMinutes(estimate + 3 * 60 * MINUTE_MS, timeZoneId)
  ]);
  if (selectedOffset !== null) offsets.add(selectedOffset);
  const matches = [...offsets].map((offset) => wall - offset * MINUTE_MS).filter((candidate) => {
    const actual = localParts(candidate, timeZoneId);
    return (selectedOffset === null || Math.abs(offsetMinutes(candidate, timeZoneId) - selectedOffset) < 1e-9)
      && actual.year === civil.year && actual.month === civil.month && actual.day === civil.day
      && actual.hour === civil.hour && actual.minute === civil.minute && actual.second === civil.second
      && actual.millisecond === civil.millisecond;
  });
  if (matches.length === 0) fail('local date-time falls in a time-zone gap or offset does not match');
  if (matches.length > 1) fail('local date-time is ambiguous; utcOffsetMinutes is required');
  return matches[0];
}

function chineseDate(milliseconds) {
  const formatter = new Intl.DateTimeFormat('en-u-ca-chinese', {
    timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(milliseconds)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const month = /^(\d+)(bis)?$/.exec(parts.month);
  if (!month) fail(`unsupported ICU Chinese month: ${parts.month}`);
  return {
    year: Number(parts.relatedYear),
    month: Number(month[1]),
    day: Number(parts.day),
    isLeapMonth: month[2] === 'bis'
  };
}

function lunarToCivilDate(input, label) {
  const value = captureRecord(input, label, ['year', 'month', 'day', 'isLeapMonth', 'time'], ['utcOffsetMinutes']);
  if (!Number.isInteger(value.year) || value.year < 1900 || value.year > 2100) fail(`${label}.year must be in [1900, 2100]`);
  if (!Number.isInteger(value.month) || value.month < 1 || value.month > 12) fail(`${label}.month must be in [1, 12]`);
  if (!Number.isInteger(value.day) || value.day < 1 || value.day > 30) fail(`${label}.day must be in [1, 30]`);
  if (typeof value.isLeapMonth !== 'boolean') fail(`${label}.isLeapMonth must be boolean`);
  const clock = parseClock(value.time, `${label}.time`);
  const start = Date.UTC(value.year - 1, 11, 1, 12);
  const end = Date.UTC(value.year + 1, 2, 1, 12);
  let matched = null;
  for (let cursor = start; cursor < end; cursor += DAY_MS) {
    const lunar = chineseDate(cursor);
    if (lunar.year === value.year && lunar.month === value.month && lunar.day === value.day
      && lunar.isLeapMonth === value.isLeapMonth) {
      if (matched !== null) fail(`${label} maps to more than one Gregorian date`);
      const date = new Date(cursor);
      matched = {
        year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
        hour: clock.hour, minute: clock.minute, second: clock.second, millisecond: clock.millisecond
      };
    }
  }
  if (matched === null) fail(`${label} is not a valid Chinese lunar date in this ICU/CLDR runtime`);
  return { civil: matched, utcOffsetMinutes: value.utcOffsetMinutes ?? null, lunar: value };
}

function inputToInstant(request, input, label) {
  let normalized;
  if (request.calendar === 'gregorian') {
    const value = captureRecord(input, label, ['local'], ['utcOffsetMinutes']);
    normalized = {
      civil: parseCivil(value.local, `${label}.local`),
      utcOffsetMinutes: value.utcOffsetMinutes ?? null,
      lunar: null
    };
  } else {
    normalized = lunarToCivilDate(input, label);
  }
  return {
    ...normalized,
    milliseconds: localToInstant(normalized.civil, request.timeZoneId, normalized.utcOffsetMinutes)
  };
}

function equationOfTimeMinutes(milliseconds) {
  const days = milliseconds / DAY_MS + 2440587.5 - 2451545;
  const anomaly = (357.529 + 0.98560028 * days) * DEG;
  const meanLongitude = normalize(280.459 + 0.98564736 * days, 360);
  const longitude = meanLongitude + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly);
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  const rightAscension = normalize(Math.atan2(Math.cos(obliquity) * Math.sin(longitude * DEG), Math.cos(longitude * DEG)) / DEG, 360);
  return normalize(meanLongitude / 15 - rightAscension / 15 + 12, 24) * 60 - 720;
}

function solarLongitude(milliseconds) {
  const days = milliseconds / DAY_MS + 2440587.5 - 2451545;
  const mean = normalize(280.459 + 0.98564736 * days, 360);
  const anomaly = (357.529 + 0.98560028 * days) * DEG;
  return normalize(mean + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly), 360);
}

function effectiveClockEpoch(milliseconds, request) {
  const civil = localParts(milliseconds, request.timeZoneId);
  let epoch = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second, civil.millisecond);
  if (request.solarTime.mode === 'true_solar') {
    const correction = equationOfTimeMinutes(milliseconds)
      + 4 * request.location.longitude - offsetMinutes(milliseconds, request.timeZoneId);
    epoch += correction * MINUTE_MS;
  }
  return Math.round(epoch);
}

function assertReferenceProfile(request) {
  if (request.boundaryProfileId !== BOUNDARY_PROFILE_ID) fail(`reference provider requires ${BOUNDARY_PROFILE_ID}`);
  if (request.solarTime.mode === 'true_solar' && request.solarTime.algorithmRef !== TRUE_SOLAR_ALGORITHM_ID) {
    fail(`reference provider requires ${TRUE_SOLAR_ALGORITHM_ID}`);
  }
}

function pillar(index) {
  const normalized = normalize(index, 60);
  return { stemId: STEMS[normalized % 10], branchId: BRANCHES[normalized % 12] };
}

function layersAt(milliseconds, request, enforceJieUncertainty = false) {
  const longitude = solarLongitude(milliseconds);
  if (enforceJieUncertainty) {
    let distance = Infinity;
    for (let index = 1; index < 24; index += 2) {
      distance = Math.min(distance, Math.abs(normalize(longitude - index * 15 + 180, 360) - 180));
    }
    if (distance / 0.98564736 * 1440 <= 8) fail('instant is within the reference solar-term uncertainty window');
  }
  const instant = new Date(milliseconds);
  const gregorianYear = instant.getUTCFullYear();
  const gregorianMonth = instant.getUTCMonth() + 1;
  const beforeSpring = gregorianMonth === 1 || (gregorianMonth === 2 && longitude < 315);
  const yearIndex = normalize((beforeSpring ? gregorianYear - 1 : gregorianYear) - 1984, 60);
  const termIndex = normalize(Math.floor(longitude / 15), 24);
  const jieIndex = termIndex % 2 === 0 ? normalize(termIndex - 1, 24) : termIndex;
  const monthBranchIndex = normalize(Math.floor((jieIndex - 21) / 2) + 2, 12);
  const monthStemIndex = normalize((yearIndex % 5) * 2 + 2 + normalize(monthBranchIndex - 2, 12), 10);
  const clockEpoch = effectiveClockEpoch(milliseconds, request);
  const clock = new Date(clockEpoch);
  const dayJulian = Math.floor(clockEpoch / DAY_MS + 2440587.5 + 0.5);
  const dayIndex = normalize(dayJulian + 49, 60);
  const hourBranchIndex = Math.floor(normalize(clock.getUTCHours() + clock.getUTCMinutes() / 60 + 1, 24) / 2);
  const hourStemIndex = normalize((dayIndex % 5) * 2 + hourBranchIndex, 10);
  return {
    year: pillar(yearIndex),
    month: { stemId: STEMS[monthStemIndex], branchId: BRANCHES[monthBranchIndex] },
    day: pillar(dayIndex),
    hour: { stemId: STEMS[hourStemIndex], branchId: BRANCHES[hourBranchIndex] }
  };
}

function nextTimeZoneTransition(start, end, timeZoneId) {
  const initial = offsetMinutes(start + 1, timeZoneId);
  let previous = start + 1;
  for (let cursor = Math.min(previous + 6 * 60 * MINUTE_MS, end); cursor <= end; cursor = Math.min(cursor + 6 * 60 * MINUTE_MS, end)) {
    if (offsetMinutes(cursor, timeZoneId) !== initial) {
      let low = previous;
      let high = cursor;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offsetMinutes(middle, timeZoneId) === initial) low = middle;
        else high = middle;
      }
      return high;
    }
    if (cursor === end) break;
    previous = cursor;
  }
  return null;
}

function nextClockBoundary(start, end, request) {
  const current = effectiveClockEpoch(start + 1, request);
  const date = new Date(current);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const targets = [dayStart + DAY_MS];
  for (let hour = 1; hour < 24; hour += 2) targets.push(dayStart + hour * 60 * MINUTE_MS);
  const target = Math.min(...targets.filter((value) => value > current));
  const estimate = Math.min(end, start + (target - current) + 30 * MINUTE_MS);
  const transition = nextTimeZoneTransition(start, estimate, request.timeZoneId);
  if (transition !== null) return transition;
  let low = start;
  let high = estimate;
  while (effectiveClockEpoch(high, request) < target && high < end) high = Math.min(end, high + 30 * MINUTE_MS);
  if (effectiveClockEpoch(high, request) < target) return null;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (effectiveClockEpoch(middle, request) < target) low = middle;
    else high = middle;
  }
  return high;
}

function nextJieBoundary(start, end) {
  const origin = solarLongitude(start + 1);
  const targets = Array.from({ length: 12 }, (_, index) => index * 30 + 15);
  const delta = Math.min(...targets.map((target) => normalize(target - origin, 360)).filter((value) => value > 1e-9));
  let low = start;
  let high = Math.min(end, start + (delta / 0.98564736 + 2) * DAY_MS);
  const progress = (milliseconds) => normalize(solarLongitude(milliseconds) - origin, 360);
  if (progress(high) < delta) return null;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (progress(middle) < delta) low = middle;
    else high = middle;
  }
  return high;
}

function adjacentJieBoundaries(milliseconds) {
  const end = milliseconds + 40 * DAY_MS;
  let cursor = milliseconds - 40 * DAY_MS;
  let previous = null;
  while (cursor < end) {
    const boundary = nextJieBoundary(cursor, end);
    if (boundary === null) break;
    if (boundary > milliseconds) return { previous, next: boundary };
    previous = boundary;
    cursor = boundary + 1;
  }
  fail('reference provider could not bracket adjacent Jie boundaries');
}

function clockBoundaryDistances(milliseconds, request) {
  const effective = effectiveClockEpoch(milliseconds, request);
  const date = new Date(effective);
  const civil = localParts(milliseconds, request.timeZoneId);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const hourTargets = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset += 1) {
    for (let hour = 1; hour < 24; hour += 2) hourTargets.push(dayStart + dayOffset * DAY_MS + hour * 60 * MINUTE_MS);
  }
  const previousHour = Math.max(...hourTargets.filter((value) => value <= effective));
  const nextHour = Math.min(...hourTargets.filter((value) => value > effective));
  const previousDay = dayStart;
  const nextDay = dayStart + DAY_MS;
  const civilClockMs = Date.UTC(
    civil.year, civil.month - 1, civil.day, civil.hour,
    civil.minute, civil.second, civil.millisecond,
  );
  return {
    effectiveClockMs: effective,
    effectiveClockIso: new Date(effective).toISOString().replace('Z', ''),
    solarCorrectionMs: effective - civilClockMs,
    previousHourBoundaryMs: effective - previousHour,
    nextHourBoundaryMs: nextHour - effective,
    previousDayBoundaryMs: effective - previousDay,
    nextDayBoundaryMs: nextDay - effective
  };
}

function decisionTrace(request, resolvedInput) {
  const jie = adjacentJieBoundaries(resolvedInput.milliseconds);
  const clock = clockBoundaryDistances(resolvedInput.milliseconds, request);
  return {
    version: CALENDAR_DECISION_TRACE_VERSION,
    requestHash: request.requestHash,
    calendarProfileId: request.boundaryProfileId,
    input: {
      calendar: request.calendar,
      declaredPrecision: 'second',
      civilInput: resolvedInput.civil,
      utcInstantMs: resolvedInput.milliseconds,
      utcInstant: new Date(resolvedInput.milliseconds).toISOString(),
      timeZoneId: request.timeZoneId,
      location: request.location,
      solarTime: request.solarTime
    },
    decisions: {
      timeZoneRule: 'iana_tzdb_via_intl',
      historicalOffsetResolved: true,
      solarClock: request.solarTime.mode,
      timeQuantization: 'integer_millisecond_round_half_up_from_positive_epoch',
      effectiveClockMs: clock.effectiveClockMs,
      effectiveClockIso: clock.effectiveClockIso,
      solarCorrectionMs: clock.solarCorrectionMs,
      yearBoundary: 'li_chun_jie',
      monthBoundary: 'twelve_jie_not_zhongqi',
      dayBoundary: 'effective_clock_midnight',
      ziHourRule: 'zi_spans_23_to_01_day_changes_at_midnight',
      previousJieInstantMs: jie.previous,
      previousJieInstant: new Date(jie.previous).toISOString(),
      nextJieInstantMs: jie.next,
      nextJieInstant: new Date(jie.next).toISOString()
    },
    boundaryDistances: {
      previousHourBoundaryMs: clock.previousHourBoundaryMs,
      nextHourBoundaryMs: clock.nextHourBoundaryMs,
      previousDayBoundaryMs: clock.previousDayBoundaryMs,
      nextDayBoundaryMs: clock.nextDayBoundaryMs,
      previousJieBoundaryMs: resolvedInput.milliseconds - jie.previous,
      nextJieBoundaryMs: jie.next - resolvedInput.milliseconds
    },
    uncertainty: {
      status: 'bounded_reference_candidate',
      solarTermFailClosedWindowMs: 8 * MINUTE_MS,
      providerAuthority: 'reference_candidate',
      unresolved: ['multi_provider_agreement', 'birth_record_precision_beyond_declared_input']
    },
    alternatives: []
  };
}

function sameLayers(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function provenance(request, algorithmRefs, metadata) {
  return {
    version: PROVENANCE_VERSION,
    authorityId: PROVIDER_ID,
    authorityVersion: PROVIDER_VERSION,
    sourceRefs: [...REFERENCE_CALENDAR_SOURCE_REFS],
    algorithmRefs,
    requestHash: request.requestHash,
    metadata: {
      timeZoneId: request.timeZoneId,
      runtimeVersions,
      calendar: request.calendar,
      solarTimeMode: request.solarTime.mode,
      boundaryProfileId: request.boundaryProfileId,
      solarTermPrecision: 'approximate_fail_closed_within_8_minutes',
      ...metadata
    }
  };
}

function algorithms(request) {
  return [
    'iana-intl-local-time.v1',
    ...(request.calendar === 'lunar' ? ['icu-chinese-calendar-reverse-search.v1'] : []),
    'meeus-two-term-solar-longitude.v1',
    ...(request.solarTime.mode === 'true_solar' ? [TRUE_SOLAR_ALGORITHM_ID] : []),
    'bazi-five-tigers.v1',
    'bazi-five-rats.v1',
    'bazi-julian-day-cycle.v1'
  ];
}

async function resolveInstant(request) {
  assertReferenceProfile(request);
  const resolvedInput = inputToInstant(request, request.input, 'timeRequest.input');
  return deepFreeze({
    version: 'bazi.resolved_time_query.v2',
    mode: 'instant',
    at: new Date(resolvedInput.milliseconds).toISOString(),
    layers: layersAt(resolvedInput.milliseconds, request, true),
    decisionTrace: decisionTrace(request, resolvedInput),
    provenance: provenance(request, algorithms(request), {
      resolvedGregorianLocal: resolvedInput.civil,
      lunarInput: resolvedInput.lunar
    })
  });
}

async function resolveRange(request) {
  assertReferenceProfile(request);
  const start = inputToInstant(request, request.startInput, 'timeRequest.startInput');
  const end = inputToInstant(request, request.endInput, 'timeRequest.endInput');
  if (start.milliseconds >= end.milliseconds) fail('resolved time range must have positive duration');
  const segments = [];
  let cursor = start.milliseconds;
  while (cursor < end.milliseconds) {
    if (segments.length >= MAX_RANGE_SEGMENTS) fail(`reference provider range exceeds ${MAX_RANGE_SEGMENTS} segments`);
    const layers = layersAt(cursor, request);
    const candidates = [
      nextClockBoundary(cursor, end.milliseconds, request),
      nextJieBoundary(cursor, end.milliseconds),
      end.milliseconds
    ].filter((value) => value !== null && value > cursor);
    const until = Math.min(...candidates);
    const previous = segments.at(-1);
    if (previous && sameLayers(previous.layers, layers)) previous.until = new Date(until).toISOString();
    else segments.push({ from: new Date(cursor).toISOString(), until: new Date(until).toISOString(), layers });
    cursor = until;
  }
  return deepFreeze({
    version: 'bazi.resolved_time_query.v1',
    mode: 'range',
    start: new Date(start.milliseconds).toISOString(),
    end: new Date(end.milliseconds).toISOString(),
    segments,
    provenance: provenance(request, algorithms(request), {
      resolvedGregorianStart: start.civil,
      resolvedGregorianEnd: end.civil,
      lunarStartInput: start.lunar,
      lunarEndInput: end.lunar,
      segmentation: 'calculated_clock_timezone_and_jie_boundaries'
    })
  });
}

export const REFERENCE_CALENDAR_PROVIDER = Object.freeze({
  providerId: PROVIDER_ID,
  version: PROVIDER_VERSION,
  sourceRefs: REFERENCE_CALENDAR_SOURCE_REFS,
  resolveInstant,
  resolveRange
});

export const REFERENCE_CALENDAR_PROFILE = Object.freeze({
  boundaryProfileId: BOUNDARY_PROFILE_ID,
  trueSolarAlgorithmId: TRUE_SOLAR_ALGORITHM_ID,
  supportedCalendars: Object.freeze(['gregorian', 'lunar']),
  supportedLunarYears: Object.freeze([1900, 2100]),
  authority: 'reference_candidate',
  productAuthority: false
});
