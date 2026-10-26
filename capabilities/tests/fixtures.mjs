export const pillars = Object.freeze({
  year: Object.freeze({ stemId: 'geng', branchId: 'chen' }),
  month: Object.freeze({ stemId: 'gui', branchId: 'wei' }),
  day: Object.freeze({ stemId: 'jia', branchId: 'zi' }),
  hour: Object.freeze({ stemId: 'geng', branchId: 'wu' })
});

export function chart(subjectRef = 'subject:a', snapshotRef = `snapshot:${subjectRef}`, overrides = {}) {
  return {
    version: 'bazi.capability_chart.v1',
    subjectRef,
    snapshotRef,
    validTimeRef: `time:${subjectRef}`,
    pillars,
    provenance: provenance(),
    ...overrides
  };
}

export const layersA = Object.freeze({
  year: Object.freeze({ stemId: 'bing', branchId: 'wu' }),
  month: Object.freeze({ stemId: 'bing', branchId: 'shen' }),
  day: Object.freeze({ stemId: 'ding', branchId: 'you' }),
  hour: Object.freeze({ stemId: 'xin', branchId: 'chou' })
});

export const layersB = Object.freeze({
  ...layersA,
  hour: Object.freeze({ stemId: 'ren', branchId: 'yin' })
});

export function instantQuery(overrides = {}) {
  return {
    version: 'bazi.resolved_time_query.v1',
    mode: 'instant',
    at: '2026-01-01T02:30:00Z',
    layers: layersA,
    provenance: provenance(),
    ...overrides
  };
}

export function rangeQuery(overrides = {}) {
  return {
    version: 'bazi.resolved_time_query.v1',
    mode: 'range',
    start: '2026-01-01T02:00:00Z',
    end: '2026-01-01T04:00:00Z',
    segments: [
      { from: '2026-01-01T02:00:00Z', until: '2026-01-01T03:00:00Z', layers: layersA },
      { from: '2026-01-01T03:00:00Z', until: '2026-01-01T04:00:00Z', layers: layersB }
    ],
    provenance: provenance(),
    ...overrides
  };
}
const TEST_HASH = `sha256:${'a'.repeat(64)}`;

export function provenance(overrides = {}) {
  return {
    version: 'bazi.capability_provenance.v1',
    authorityId: 'test-authority',
    authorityVersion: '1.0.0',
    sourceRefs: ['test:source'],
    algorithmRefs: ['test:algorithm'],
    requestHash: TEST_HASH,
    ...overrides
  };
}

function temporalOccurrence(layerId, pillar, validFrom, validUntil, subjectRef = null) {
  return {
    layerId,
    occurrenceId: `time.${layerId}:fixture-2026-01-01`,
    subjectRef,
    pillar,
    validFrom,
    validUntil,
    termRef: `fixture:term:${layerId}`,
    sourceRefs: [`fixture:source:${layerId}`],
    authorityRef: `fixture:authority:${layerId}`,
    calculationProfileRef: `fixture:calculation-profile:${layerId}`,
    calendarBasisRef: `fixture:calendar-basis:${layerId}`,
    boundaryProfileRef: `fixture:boundary-profile:${layerId}`,
    locationTimeRef: 'fixture:location-time:utc',
    inputDependencyRefs: [`fixture:dependency:${layerId}`],
    decisionRefs: [`fixture:decision:${layerId}`]
  };
}

export function sixLayerInput(overrides = {}) {
  return {
    version: 'bazi.six_layer_temporal_input.v1',
    subjectRef: 'subject:a',
    snapshotRef: 'snapshot:subject:a',
    at: '2026-01-01T02:30:00Z',
    layers: [
      temporalOccurrence(
        'major_luck',
        { stemId: 'yi', branchId: 'si' },
        '2024-01-01T00:00:00Z',
        '2034-01-01T00:00:00Z',
        'subject:a'
      ),
      temporalOccurrence(
        'minor_luck',
        { stemId: 'geng', branchId: 'xu' },
        '2025-07-19T00:00:00Z',
        '2026-07-19T00:00:00Z',
        'subject:a'
      ),
      temporalOccurrence('year', layersA.year, '2025-02-03T00:00:00Z', '2026-02-04T00:00:00Z'),
      temporalOccurrence('month', layersA.month, '2025-12-07T00:00:00Z', '2026-01-05T00:00:00Z'),
      temporalOccurrence('day', layersA.day, '2025-12-31T16:00:00Z', '2026-01-01T16:00:00Z'),
      temporalOccurrence('hour', layersA.hour, '2026-01-01T01:00:00Z', '2026-01-01T03:00:00Z')
    ],
    provenance: provenance({
      authorityId: 'fixture-six-layer-authority',
      algorithmRefs: ['fixture:six-layer-explicit-input']
    }),
    ...overrides
  };
}
