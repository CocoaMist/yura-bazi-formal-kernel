import { captureResolvedTimeQuery } from './contracts.mjs';
import { assertNonEmptyString, captureJson, captureRecord, contentHash, deepFreeze, fail } from './shared.mjs';

function captureTimeZone(value) {
  const timeZoneId = assertNonEmptyString(value, 'timeRequest.timeZoneId');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timeZoneId }).format(0);
  } catch {
    fail('timeRequest.timeZoneId must be a valid IANA time zone');
  }
  return timeZoneId;
}

function captureLocation(value) {
  const input = captureRecord(value, 'timeRequest.location', ['longitude', 'latitude'], ['label']);
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    fail('timeRequest.location.longitude must be between -180 and 180');
  }
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    fail('timeRequest.location.latitude must be between -90 and 90');
  }
  return {
    longitude: input.longitude,
    latitude: input.latitude,
    ...(Object.hasOwn(input, 'label') ? { label: assertNonEmptyString(input.label, 'timeRequest.location.label') } : {})
  };
}

function captureSolarTime(value, hasLocation) {
  const header = captureRecord(value, 'timeRequest.solarTime', ['mode'], ['algorithmRef']);
  if (header.mode === 'civil') {
    captureRecord(value, 'timeRequest.solarTime', ['mode']);
    return { mode: 'civil' };
  }
  if (header.mode !== 'true_solar') fail('timeRequest.solarTime.mode must be civil or true_solar');
  if (!hasLocation) fail('true_solar mode requires timeRequest.location');
  const input = captureRecord(value, 'timeRequest.solarTime', ['mode', 'algorithmRef']);
  return {
    mode: input.mode,
    algorithmRef: assertNonEmptyString(input.algorithmRef, 'timeRequest.solarTime.algorithmRef')
  };
}

export function captureTimeRequest(value) {
  const header = captureRecord(value, 'timeRequest', [
    'version', 'mode', 'calendar', 'timeZoneId', 'solarTime', 'boundaryProfileId'
  ], ['location', 'input', 'startInput', 'endInput']);
  if (header.version !== 'bazi.time_request.v1') fail('timeRequest.version is unsupported');
  if (!['gregorian', 'lunar'].includes(header.calendar)) fail('timeRequest.calendar must be gregorian or lunar');
  const location = Object.hasOwn(header, 'location') ? captureLocation(header.location) : null;
  const common = {
    version: header.version,
    mode: header.mode,
    calendar: header.calendar,
    timeZoneId: captureTimeZone(header.timeZoneId),
    location,
    solarTime: captureSolarTime(header.solarTime, location !== null),
    boundaryProfileId: assertNonEmptyString(header.boundaryProfileId, 'timeRequest.boundaryProfileId')
  };
  if (header.mode === 'instant') {
    const input = captureRecord(value, 'timeRequest', [
      'version', 'mode', 'calendar', 'timeZoneId', 'solarTime', 'boundaryProfileId', 'input'
    ], ['location']);
    const body = { ...common, input: captureJson(input.input, 'timeRequest.input') };
    return deepFreeze({ ...body, requestHash: contentHash(body) });
  }
  if (header.mode !== 'range') fail('timeRequest.mode must be instant or range');
  const input = captureRecord(value, 'timeRequest', [
    'version', 'mode', 'calendar', 'timeZoneId', 'solarTime', 'boundaryProfileId', 'startInput', 'endInput'
  ], ['location']);
  const body = {
    ...common,
    startInput: captureJson(input.startInput, 'timeRequest.startInput'),
    endInput: captureJson(input.endInput, 'timeRequest.endInput')
  };
  return deepFreeze({ ...body, requestHash: contentHash(body) });
}

function captureProvider(value) {
  const input = captureRecord(value, 'calendarProvider', [
    'providerId', 'version', 'sourceRefs', 'resolveInstant', 'resolveRange'
  ]);
  if (!Array.isArray(input.sourceRefs) || input.sourceRefs.length === 0) {
    fail('calendarProvider.sourceRefs must not be empty');
  }
  const sourceRefs = captureJson(input.sourceRefs, 'calendarProvider.sourceRefs')
    .map((item, index) => assertNonEmptyString(item, `calendarProvider.sourceRefs[${index}]`));
  if (typeof input.resolveInstant !== 'function' || typeof input.resolveRange !== 'function') {
    fail('calendarProvider must implement resolveInstant and resolveRange');
  }
  return {
    providerId: assertNonEmptyString(input.providerId, 'calendarProvider.providerId'),
    version: assertNonEmptyString(input.version, 'calendarProvider.version'),
    sourceRefs,
    resolveInstant: input.resolveInstant,
    resolveRange: input.resolveRange
  };
}

export async function resolveTimeRequest(requestValue, providerValue, options = {}) {
  const request = captureTimeRequest(requestValue);
  const provider = captureProvider(providerValue);
  const settings = captureRecord(options, 'calendar.options', [], ['maxSegments']);
  const method = request.mode === 'instant' ? provider.resolveInstant : provider.resolveRange;
  const resolved = captureResolvedTimeQuery(await method(request), { maxSegments: settings.maxSegments });
  if (resolved.mode !== request.mode) fail('calendarProvider returned the wrong query mode');
  if (resolved.provenance.requestHash !== request.requestHash) {
    fail('calendarProvider result is not bound to the normalized request');
  }
  if (resolved.decisionTrace && resolved.decisionTrace.requestHash !== request.requestHash) {
    fail('calendarProvider decision trace is not bound to the normalized request');
  }
  if (resolved.provenance.authorityId !== provider.providerId
    || resolved.provenance.authorityVersion !== provider.version) {
    fail('calendarProvider result authority does not match the provider descriptor');
  }
  if (JSON.stringify(resolved.provenance.sourceRefs) !== JSON.stringify(provider.sourceRefs)) {
    fail('calendarProvider result sources do not match the provider descriptor');
  }
  const providerIdentity = {
    providerId: provider.providerId,
    version: provider.version,
    sourceRefs: provider.sourceRefs
  };
  const body = {
    version: resolved.version === 'bazi.resolved_time_query.v2'
      ? 'bazi.calendar_resolution.v2'
      : 'bazi.calendar_resolution.v1',
    request,
    provider: providerIdentity,
    resolved
  };
  return deepFreeze({ ...body, resolutionHash: contentHash(body) });
}
