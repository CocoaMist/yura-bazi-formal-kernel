import test from 'node:test';
import assert from 'node:assert/strict';
import { captureResolvedTimeQuery, captureSixLayerTemporalInput } from '../src/contracts.mjs';
import { compileSixLayerTemporalRelations, evaluateTemporal } from '../src/temporal.mjs';
import { chart, instantQuery, rangeQuery, sixLayerInput } from './fixtures.mjs';

test('instant evaluates natal relations and adjacent time layers', () => {
  const result = evaluateTemporal(chart(), instantQuery());
  assert.equal(result.queryMode, 'instant');
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].kind, 'instant');
  assert.equal(result.segments[0].at, '2026-01-01T02:30:00.000Z');
  assert.equal(Object.hasOwn(result.segments[0], 'validUntil'), false);
  assert.equal(result.segments[0].natalRelations.length, 16);
  assert.deepEqual(
    result.segments[0].timeRelations.map(({ leftLayer, rightLayer }) => [leftLayer, rightLayer]),
    [['year', 'month'], ['month', 'day'], ['day', 'hour']]
  );
  assert.equal(result.effectEligible, false);
});

test('cross-level time relations are opt-in', () => {
  const result = evaluateTemporal(chart(), instantQuery(), { includeCrossLevel: true });
  assert.equal(result.segments[0].timeRelations.length, 6);
});

test('range preserves authoritative contiguous segments', () => {
  const result = evaluateTemporal(chart(), rangeQuery());
  assert.equal(result.queryMode, 'range');
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].validUntil, result.segments[1].validFrom);
  assert.equal(result.segments[1].layers.hour.branchId, 'yin');
});

test('range rejects gaps, overlaps and segment overflow', () => {
  const gap = rangeQuery();
  gap.segments[1] = { ...gap.segments[1], from: '2026-01-01T03:01:00Z' };
  assert.throws(() => captureResolvedTimeQuery(gap), /contiguous/);

  const overlap = rangeQuery();
  overlap.segments[1] = { ...overlap.segments[1], from: '2026-01-01T02:59:00Z' };
  assert.throws(() => captureResolvedTimeQuery(overlap), /contiguous/);

  assert.throws(() => captureResolvedTimeQuery(rangeQuery(), { maxSegments: 1 }), /exceeds 1/);
});

test('instant requires explicit offset and valid pillar grammar', () => {
  const noOffset = instantQuery();
  noOffset.at = '2026-01-01T02:30:00';
  assert.throws(() => captureResolvedTimeQuery(noOffset), /explicit UTC offset/);

  const invalidMonth = instantQuery();
  invalidMonth.layers = {
    ...invalidMonth.layers,
    month: { stemId: 'jia', branchId: 'shen' }
  };
  assert.throws(() => captureResolvedTimeQuery(invalidMonth), /five-tigers/);
});

test('evaluation identity includes chart valid time and provenance', () => {
  const first = evaluateTemporal(chart(), instantQuery());
  const corrected = chart('subject:a', 'snapshot:subject:a', { validTimeRef: 'time:corrected' });
  const second = evaluateTemporal(corrected, instantQuery());
  assert.notEqual(first.evaluationId, second.evaluationId);
  assert.equal(first.scopeProfileId, 'bazi.temporal_scope.natal_and_explicit_layers_raw.v1');
});

test('six-layer compiler preserves six occurrences and computes the complete raw pair closure', () => {
  const result = compileSixLayerTemporalRelations(chart(), sixLayerInput());
  assert.equal(result.temporalOccurrences.length, 6);
  assert.equal(result.natalTemporalRelations.length, 24);
  assert.equal(result.interLayerRelations.length, 15);
  assert.deepEqual(result.cardinality, {
    temporalOccurrences: 6,
    natalTemporalPillarPairs: 24,
    interLayerPillarPairs: 15,
    completeBranchGroups: result.branchGroups.length
  });
  assert.equal(result.relationClosure.maximumDerivedDepth, 1);
  assert.equal(result.relationClosure.syntheticOccurrenceCreation, false);
  assert.equal(result.judgmentStatus, 'not_evaluated');
  assert.equal(result.causalStatus, 'not_modeled');
  assert.equal(result.effectEligible, false);
  assert.match(result.relationSetHash, /^sha256:[0-9a-f]{64}$/);
});

test('six-layer compiler keeps every pair bound to explicit occurrence identities', () => {
  const result = compileSixLayerTemporalRelations(chart(), sixLayerInput());
  const occurrenceIds = new Set(result.temporalOccurrences.map((item) => item.occurrenceId));
  for (const edge of result.natalTemporalRelations) {
    assert.equal(occurrenceIds.has(edge.temporalOccurrenceId), true);
    assert.equal(edge.relation.stem.right.occurrenceId, edge.temporalOccurrenceId);
    assert.equal(edge.relation.branch.right.occurrenceId, edge.temporalOccurrenceId);
  }
  for (const edge of result.interLayerRelations) {
    assert.equal(occurrenceIds.has(edge.leftOccurrenceId), true);
    assert.equal(occurrenceIds.has(edge.rightOccurrenceId), true);
    assert.equal(edge.relation.stem.left.occurrenceId, edge.leftOccurrenceId);
    assert.equal(edge.relation.branch.right.occurrenceId, edge.rightOccurrenceId);
  }
});

test('six-layer input rejects missing, duplicated, unbound, and out-of-window occurrences', () => {
  const missing = sixLayerInput();
  missing.layers = missing.layers.slice(0, 5);
  assert.throws(() => captureSixLayerTemporalInput(missing), /exactly 6/);

  const repeated = sixLayerInput();
  repeated.layers[1] = { ...repeated.layers[1], layerId: 'major_luck' };
  assert.throws(() => captureSixLayerTemporalInput(repeated), /occurrenceId must start|repeats major_luck/);

  const wrongSubject = sixLayerInput();
  wrongSubject.layers[0] = { ...wrongSubject.layers[0], subjectRef: 'subject:b' };
  assert.throws(() => captureSixLayerTemporalInput(wrongSubject), /must bind the input subjectRef/);

  const outOfWindow = sixLayerInput({ at: '2035-01-01T00:00:00Z' });
  assert.throws(() => captureSixLayerTemporalInput(outOfWindow), /outside major_luck validity/);
});

test('six-layer input identity retains source decisions independently from relation codes', () => {
  const first = compileSixLayerTemporalRelations(chart(), sixLayerInput());
  const changed = sixLayerInput();
  changed.layers[1] = {
    ...changed.layers[1],
    decisionRefs: ['fixture:decision:minor_luck:alternative-tradition']
  };
  const second = compileSixLayerTemporalRelations(chart(), changed);
  assert.notEqual(first.inputHash, second.inputHash);
  assert.notEqual(first.relationSetHash, second.relationSetHash);
  assert.deepEqual(
    first.interLayerRelations.map((edge) => edge.relation.stem.codes),
    second.interLayerRelations.map((edge) => edge.relation.stem.codes)
  );
});
