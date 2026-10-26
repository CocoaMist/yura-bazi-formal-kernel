import {
  BRANCHES,
  PILLAR_SLOTS,
  SIX_LAYER_TEMPORAL_IDS,
  STEMS,
  TIME_LAYERS
} from './profile.mjs';
import {
  assertNonEmptyString,
  canonicalInstant,
  captureJson,
  captureRecord,
  contentHash,
  deepFreeze,
  fail,
  instantMs
} from './shared.mjs';

export const PROVENANCE_VERSION = 'bazi.capability_provenance.v1';
export const CALENDAR_DECISION_TRACE_VERSION = 'bazi.calendar_decision_trace.v2';
export const LEGACY_CALENDAR_DECISION_TRACE_VERSION = 'bazi.calendar_decision_trace.v1';
export const SIX_LAYER_TEMPORAL_INPUT_VERSION = 'bazi.six_layer_temporal_input.v1';

function captureDecisionTrace(value, label) {
  const input = captureRecord(value, label, [
    'version', 'requestHash', 'calendarProfileId', 'input', 'decisions',
    'boundaryDistances', 'uncertainty', 'alternatives'
  ]);
  if (![LEGACY_CALENDAR_DECISION_TRACE_VERSION, CALENDAR_DECISION_TRACE_VERSION].includes(input.version)) {
    fail(`${label}.version is unsupported`);
  }
  const requestHash = assertNonEmptyString(input.requestHash, `${label}.requestHash`);
  if (!/^sha256:[0-9a-f]{64}$/.test(requestHash)) fail(`${label}.requestHash must be a sha256 hash`);
  const captured = {
    version: input.version,
    requestHash,
    calendarProfileId: assertNonEmptyString(input.calendarProfileId, `${label}.calendarProfileId`),
    input: captureJson(input.input, `${label}.input`),
    decisions: captureJson(input.decisions, `${label}.decisions`),
    boundaryDistances: captureJson(input.boundaryDistances, `${label}.boundaryDistances`),
    uncertainty: captureJson(input.uncertainty, `${label}.uncertainty`),
    alternatives: captureJson(input.alternatives, `${label}.alternatives`)
  };
  if (input.version === CALENDAR_DECISION_TRACE_VERSION) {
    for (const [field, value] of [
      ['input.utcInstantMs', captured.input.utcInstantMs],
      ['decisions.effectiveClockMs', captured.decisions.effectiveClockMs],
      ['decisions.solarCorrectionMs', captured.decisions.solarCorrectionMs],
      ['decisions.previousJieInstantMs', captured.decisions.previousJieInstantMs],
      ['decisions.nextJieInstantMs', captured.decisions.nextJieInstantMs],
    ]) {
      if (!Number.isSafeInteger(value)) fail(`${label}.${field} must be an integer millisecond`);
    }
  }
  return captured;
}

function captureStringList(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const captured = captureJson(value, label);
  const strings = captured.map((item, index) => assertNonEmptyString(item, `${label}[${index}]`));
  if (!allowEmpty && strings.length === 0) fail(`${label} must not be empty`);
  return strings;
}

export function captureProvenance(value, label = 'provenance') {
  const input = captureRecord(value, label, [
    'version', 'authorityId', 'authorityVersion', 'sourceRefs', 'algorithmRefs', 'requestHash'
  ], ['metadata']);
  if (input.version !== PROVENANCE_VERSION) fail(`${label}.version is unsupported`);
  const requestHash = assertNonEmptyString(input.requestHash, `${label}.requestHash`);
  if (!/^sha256:[0-9a-f]{64}$/.test(requestHash)) fail(`${label}.requestHash must be a sha256 hash`);
  return {
    version: input.version,
    authorityId: assertNonEmptyString(input.authorityId, `${label}.authorityId`),
    authorityVersion: assertNonEmptyString(input.authorityVersion, `${label}.authorityVersion`),
    sourceRefs: captureStringList(input.sourceRefs, `${label}.sourceRefs`),
    algorithmRefs: captureStringList(input.algorithmRefs, `${label}.algorithmRefs`, true),
    requestHash,
    ...(Object.hasOwn(input, 'metadata') ? { metadata: captureJson(input.metadata, `${label}.metadata`) } : {})
  };
}

function capturePillar(value, label) {
  const input = captureRecord(value, label, ['stemId', 'branchId']);
  const stemIndex = STEMS.indexOf(input.stemId);
  const branchIndex = BRANCHES.indexOf(input.branchId);
  if (stemIndex < 0) fail(`${label}.stemId is unknown`);
  if (branchIndex < 0) fail(`${label}.branchId is unknown`);
  if (stemIndex % 2 !== branchIndex % 2) fail(`${label} is not a sexagenary pillar`);
  return { stemId: input.stemId, branchId: input.branchId };
}

function expectedMonthStem(yearStemId, monthBranchId) {
  const start = (STEMS.indexOf(yearStemId) % 5 * 2 + 2) % 10;
  const offset = (BRANCHES.indexOf(monthBranchId) - 2 + 12) % 12;
  return STEMS[(start + offset) % 10];
}

function expectedHourStem(dayStemId, hourBranchId) {
  const start = STEMS.indexOf(dayStemId) % 5 * 2;
  return STEMS[(start + BRANCHES.indexOf(hourBranchId)) % 10];
}

function captureFourPillars(value, label) {
  const input = captureRecord(value, label, PILLAR_SLOTS);
  const pillars = Object.fromEntries(PILLAR_SLOTS.map((slot) => [slot, capturePillar(input[slot], `${label}.${slot}`)]));
  if (pillars.month.stemId !== expectedMonthStem(pillars.year.stemId, pillars.month.branchId)) {
    fail(`${label}.month violates the five-tigers month-stem rule`);
  }
  if (pillars.hour.stemId !== expectedHourStem(pillars.day.stemId, pillars.hour.branchId)) {
    fail(`${label}.hour violates the five-rats hour-stem rule`);
  }
  return pillars;
}

export function captureChartRecord(value) {
  const input = captureRecord(value, 'chart', [
    'version', 'subjectRef', 'snapshotRef', 'validTimeRef', 'pillars', 'provenance'
  ]);
  if (input.version !== 'bazi.capability_chart.v1') fail('chart.version is unsupported');
  const chart = {
    version: input.version,
    subjectRef: assertNonEmptyString(input.subjectRef, 'chart.subjectRef'),
    snapshotRef: assertNonEmptyString(input.snapshotRef, 'chart.snapshotRef'),
    validTimeRef: assertNonEmptyString(input.validTimeRef, 'chart.validTimeRef'),
    pillars: captureFourPillars(input.pillars, 'chart.pillars'),
    provenance: captureProvenance(input.provenance, 'chart.provenance')
  };
  chart.chartContentHash = contentHash(chart.pillars);
  chart.chartIdentityHash = contentHash({
    version: chart.version,
    subjectRef: chart.subjectRef,
    snapshotRef: chart.snapshotRef,
    validTimeRef: chart.validTimeRef,
    pillars: chart.pillars,
    provenance: chart.provenance
  });
  return deepFreeze(chart);
}

function captureTemporalLayerOccurrence(value, index) {
  const label = `sixLayerInput.layers[${index}]`;
  const input = captureRecord(value, label, [
    'layerId', 'occurrenceId', 'subjectRef', 'pillar', 'validFrom', 'validUntil',
    'termRef', 'sourceRefs', 'authorityRef', 'calculationProfileRef',
    'calendarBasisRef', 'boundaryProfileRef', 'locationTimeRef',
    'inputDependencyRefs', 'decisionRefs'
  ]);
  if (!SIX_LAYER_TEMPORAL_IDS.includes(input.layerId)) fail(`${label}.layerId is unknown`);
  const occurrenceId = assertNonEmptyString(input.occurrenceId, `${label}.occurrenceId`);
  if (!occurrenceId.startsWith(`time.${input.layerId}:`)) {
    fail(`${label}.occurrenceId must start with time.${input.layerId}:`);
  }
  const subjectRef = input.subjectRef === null
    ? null
    : assertNonEmptyString(input.subjectRef, `${label}.subjectRef`);
  const validFromMs = instantMs(input.validFrom, `${label}.validFrom`);
  const validUntilMs = instantMs(input.validUntil, `${label}.validUntil`);
  if (validFromMs >= validUntilMs) fail(`${label} must have positive duration`);
  const body = {
    layerId: input.layerId,
    occurrenceId,
    subjectRef,
    pillar: capturePillar(input.pillar, `${label}.pillar`),
    validFrom: canonicalInstant(input.validFrom, `${label}.validFrom`),
    validUntil: canonicalInstant(input.validUntil, `${label}.validUntil`),
    termRef: assertNonEmptyString(input.termRef, `${label}.termRef`),
    sourceRefs: captureStringList(input.sourceRefs, `${label}.sourceRefs`),
    authorityRef: assertNonEmptyString(input.authorityRef, `${label}.authorityRef`),
    calculationProfileRef: assertNonEmptyString(
      input.calculationProfileRef,
      `${label}.calculationProfileRef`
    ),
    calendarBasisRef: assertNonEmptyString(input.calendarBasisRef, `${label}.calendarBasisRef`),
    boundaryProfileRef: assertNonEmptyString(input.boundaryProfileRef, `${label}.boundaryProfileRef`),
    locationTimeRef: assertNonEmptyString(input.locationTimeRef, `${label}.locationTimeRef`),
    inputDependencyRefs: captureStringList(
      input.inputDependencyRefs,
      `${label}.inputDependencyRefs`
    ),
    decisionRefs: captureStringList(input.decisionRefs, `${label}.decisionRefs`)
  };
  return {
    value: deepFreeze({ ...body, occurrenceHash: contentHash(body) }),
    validFromMs,
    validUntilMs
  };
}

export function captureSixLayerTemporalInput(value) {
  const input = captureRecord(value, 'sixLayerInput', [
    'version', 'subjectRef', 'snapshotRef', 'at', 'layers', 'provenance'
  ]);
  if (input.version !== SIX_LAYER_TEMPORAL_INPUT_VERSION) {
    fail('sixLayerInput.version is unsupported');
  }
  const subjectRef = assertNonEmptyString(input.subjectRef, 'sixLayerInput.subjectRef');
  const snapshotRef = assertNonEmptyString(input.snapshotRef, 'sixLayerInput.snapshotRef');
  const atMs = instantMs(input.at, 'sixLayerInput.at');
  if (!Array.isArray(input.layers) || input.layers.length !== SIX_LAYER_TEMPORAL_IDS.length) {
    fail(`sixLayerInput.layers must contain exactly ${SIX_LAYER_TEMPORAL_IDS.length} occurrences`);
  }
  const captured = input.layers.map(captureTemporalLayerOccurrence);
  const byLayer = new Map();
  const occurrenceIds = new Set();
  for (const item of captured) {
    const layer = item.value;
    if (byLayer.has(layer.layerId)) fail(`sixLayerInput.layers repeats ${layer.layerId}`);
    if (occurrenceIds.has(layer.occurrenceId)) fail('sixLayerInput.layers repeats occurrenceId');
    byLayer.set(layer.layerId, item);
    occurrenceIds.add(layer.occurrenceId);
    if (atMs < item.validFromMs || atMs >= item.validUntilMs) {
      fail(`sixLayerInput.at is outside ${layer.layerId} validity`);
    }
    const isSubjectSpecific = layer.layerId === 'major_luck' || layer.layerId === 'minor_luck';
    if (isSubjectSpecific && layer.subjectRef !== subjectRef) {
      fail(`sixLayerInput.layers ${layer.layerId} must bind the input subjectRef`);
    }
    if (!isSubjectSpecific && layer.subjectRef !== null) {
      fail(`sixLayerInput.layers ${layer.layerId} must use subjectRef null`);
    }
  }
  for (const layerId of SIX_LAYER_TEMPORAL_IDS) {
    if (!byLayer.has(layerId)) fail(`sixLayerInput.layers is missing ${layerId}`);
  }
  const layers = SIX_LAYER_TEMPORAL_IDS.map((layerId) => byLayer.get(layerId).value);
  const year = byLayer.get('year').value.pillar;
  const month = byLayer.get('month').value.pillar;
  const day = byLayer.get('day').value.pillar;
  const hour = byLayer.get('hour').value.pillar;
  if (month.stemId !== expectedMonthStem(year.stemId, month.branchId)) {
    fail('sixLayerInput month violates the five-tigers month-stem rule');
  }
  if (hour.stemId !== expectedHourStem(day.stemId, hour.branchId)) {
    fail('sixLayerInput hour violates the five-rats hour-stem rule');
  }
  const body = {
    version: input.version,
    subjectRef,
    snapshotRef,
    at: canonicalInstant(input.at, 'sixLayerInput.at'),
    atMs,
    layers,
    provenance: captureProvenance(input.provenance, 'sixLayerInput.provenance')
  };
  return deepFreeze({ ...body, inputHash: contentHash(body) });
}

function captureLayers(value, label) {
  const input = captureRecord(value, label, ['year', 'month', 'day', 'hour'], ['decade']);
  const layers = {};
  for (const layer of TIME_LAYERS) {
    if (Object.hasOwn(input, layer)) layers[layer] = capturePillar(input[layer], `${label}.${layer}`);
  }
  const four = { year: layers.year, month: layers.month, day: layers.day, hour: layers.hour };
  if (four.month.stemId !== expectedMonthStem(four.year.stemId, four.month.branchId)) {
    fail(`${label}.month violates the five-tigers month-stem rule`);
  }
  if (four.hour.stemId !== expectedHourStem(four.day.stemId, four.hour.branchId)) {
    fail(`${label}.hour violates the five-rats hour-stem rule`);
  }
  return layers;
}

function captureSegment(value, index) {
  const label = `timeQuery.segments[${index}]`;
  const input = captureRecord(value, label, ['from', 'until', 'layers']);
  const fromMs = instantMs(input.from, `${label}.from`);
  const untilMs = instantMs(input.until, `${label}.until`);
  if (fromMs >= untilMs) fail(`${label} must have positive duration`);
  return {
    from: canonicalInstant(input.from, `${label}.from`),
    until: canonicalInstant(input.until, `${label}.until`),
    fromMs,
    untilMs,
    layers: captureLayers(input.layers, `${label}.layers`)
  };
}

export function captureResolvedTimeQuery(value, options = {}) {
  const maximum = options.maxSegments ?? 5000;
  if (!Number.isSafeInteger(maximum) || maximum < 1) fail('maxSegments must be a positive safe integer');
  const header = captureRecord(value, 'timeQuery', ['version', 'mode'], ['at', 'layers', 'start', 'end', 'segments', 'provenance', 'decisionTrace']);
  if (!['bazi.resolved_time_query.v1', 'bazi.resolved_time_query.v2'].includes(header.version)) fail('timeQuery.version is unsupported');
  if (!Object.hasOwn(header, 'provenance')) fail('timeQuery.provenance is required');
  const provenance = captureProvenance(header.provenance, 'timeQuery.provenance');

  if (header.mode === 'instant') {
    const required = header.version === 'bazi.resolved_time_query.v2'
      ? ['version', 'mode', 'at', 'layers', 'provenance', 'decisionTrace']
      : ['version', 'mode', 'at', 'layers', 'provenance'];
    const input = captureRecord(value, 'timeQuery', required);
    const atMs = instantMs(input.at, 'timeQuery.at');
    return deepFreeze({
      version: input.version,
      mode: input.mode,
      at: canonicalInstant(input.at, 'timeQuery.at'),
      atMs,
      layers: captureLayers(input.layers, 'timeQuery.layers'),
      provenance,
      ...(header.version === 'bazi.resolved_time_query.v2'
        ? { decisionTrace: captureDecisionTrace(input.decisionTrace, 'timeQuery.decisionTrace') }
        : {})
    });
  }

  if (header.mode !== 'range') fail('timeQuery.mode must be instant or range');
  if (header.version !== 'bazi.resolved_time_query.v1') fail('range timeQuery currently requires bazi.resolved_time_query.v1');
  const input = captureRecord(value, 'timeQuery', ['version', 'mode', 'start', 'end', 'segments', 'provenance']);
  const startMs = instantMs(input.start, 'timeQuery.start');
  const endMs = instantMs(input.end, 'timeQuery.end');
  if (startMs >= endMs) fail('timeQuery range must have positive duration');
  if (!Array.isArray(input.segments) || input.segments.length === 0) fail('timeQuery.segments must not be empty');
  if (input.segments.length > maximum) fail(`timeQuery.segments exceeds ${maximum}`);
  const segments = input.segments.map(captureSegment);
  if (segments[0].fromMs !== startMs || segments.at(-1).untilMs !== endMs) {
    fail('timeQuery.segments must cover the exact range');
  }
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index - 1].untilMs !== segments[index].fromMs) {
      fail('timeQuery.segments must be ordered, contiguous and non-overlapping');
    }
  }
  return deepFreeze({
    version: input.version,
    mode: input.mode,
    start: canonicalInstant(input.start, 'timeQuery.start'),
    end: canonicalInstant(input.end, 'timeQuery.end'),
    startMs,
    endMs,
    segments,
    provenance
  });
}
