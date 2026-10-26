import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
  TEMPORAL_KERNEL_REQUEST_VERSION,
  TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
  TEMPORAL_LAYER_CANDIDATE_VERSION,
  buildTemporalKernelRequestV1,
  buildTemporalLayerCandidateSetV1,
  captureTemporalKernelRequestV1,
  captureTemporalLayerCandidateSetV1,
  compileTemporalRequest,
  compileTemporalRequestWithHooks,
  domainHashV1,
} from '../../src/index.mjs';
import { RELEASE_CONTEXT } from '../helpers.mjs';
import { ACTIVE_PROFILE_ID } from '../natal-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const input = readFileSync(
  new URL('../../examples/2000-07-19-beijing-male.input.json', import.meta.url),
  'utf8',
);
const run = spawnSync(process.execPath, ['tools/compile-birth.mjs'], {
  cwd: root,
  input,
  encoding: 'utf8',
});
assert.equal(run.status, 0, run.stderr);
const natalFixedBundle = JSON.parse(run.stdout);
const subjectRef = natalFixedBundle.subjectContext.subjectRef;
const AT = 1_788_316_800_000;

function layer(layerId, stemId, branchId, subjectSpecific = false) {
  const occurrence = `time.${layerId}:test`;
  return {
    layerId,
    pillarOccurrenceId: occurrence,
    stemOccurrenceId: `${occurrence}.stem`,
    branchOccurrenceId: `${occurrence}.branch`,
    subjectRef: subjectSpecific ? subjectRef : null,
    stemId,
    branchId,
    validFromMs: AT - 1_000,
    validUntilMs: AT + 1_000,
    termRef: `term:${layerId}:test`,
    sourceTimeRef: `time-ref:${layerId}:test`,
    sourceRefs: [`source:${layerId}:test`],
    authorityRef: `authority:${layerId}:test`,
    calculationProfileRef: `calculation:${layerId}:test`,
    calendarBasisRef: `calendar:${layerId}:test`,
    boundaryProfileRef: `boundary:${layerId}:test`,
    locationTimeRef: `location:${layerId}:test`,
    inputDependencyRefs: [],
    decisionRefs: [],
  };
}

function candidate(overrides = {}) {
  return {
    version: TEMPORAL_LAYER_CANDIDATE_VERSION,
    subjectRef,
    targetInstantMs: AT,
    targetTimeRef: 'time-ref:target:test',
    layers: [
      layer('major_luck', 'jia', 'zi', true),
      layer('minor_luck', 'yi', 'chou', true),
      layer('year', 'bing', 'wu'),
      layer('month', 'bing', 'shen'),
      layer('day', 'jia', 'zi'),
      layer('hour', 'ren', 'shen'),
    ],
    provenanceRefs: ['provenance:temporal:test'],
    ...overrides,
  };
}

function inputs(candidateRows = [candidate()]) {
  const candidateSet = buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef,
    candidates: candidateRows.map((row, index) => ({
      temporalCandidateId: `temporal-candidate:${index}`,
      calendarDecisionPathRef: `temporal-calendar-path:${index}`,
      candidate: row,
    })),
    provenanceRefs: ['provenance:set:test'],
  });
  const request = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: natalFixedBundle.bundleHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
    subjectRef,
    targetRangeRef: 'age-range:test',
    provenanceRefs: ['provenance:request:test'],
    metadata: { purpose: 'test' },
  });
  return { candidateSet, request };
}

function rehash(value, hashField, domain) {
  const output = structuredClone(value);
  delete output[hashField];
  output[hashField] = domainHashV1(domain, output);
  return output;
}

function relationRichCandidate() {
  return candidate({
    layers: [
      layer('major_luck', 'wu', 'chen', true),
      layer('minor_luck', 'gui', 'si', true),
      layer('year', 'geng', 'shen'),
      layer('month', 'wu', 'zi'),
      layer('day', 'bing', 'yin'),
      layer('hour', 'ren', 'chen'),
    ],
  });
}

test('temporal core compiles six explicit layers against every distinct natal fixed state', () => {
  const { candidateSet, request } = inputs();
  assert.deepEqual(captureTemporalLayerCandidateSetV1(structuredClone(candidateSet)), candidateSet);
  assert.deepEqual(captureTemporalKernelRequestV1(structuredClone(request)), request);
  const batch = compileTemporalRequest(request, candidateSet, natalFixedBundle, RELEASE_CONTEXT);
  assert.equal(batch.status, 'compiled');
  assert.equal(batch.inputCount, 1);
  assert.equal(batch.resultCount, 1);
  assert.equal(batch.results[0].candidate.layers.length, 6);
  assert.equal(batch.results[0].interTemporalRelationSet.pillarPairCount, 15);
  assert.equal(batch.results[0].fixedStateResultCount, natalFixedBundle.distinctFixedStateCount);
  assert.equal(
    batch.results[0].fixedStateResults[0].rawStructuralMatchSet.temporalOccurrenceCount,
    12,
  );
  assert.equal(batch.results[0].fixedStateResults[0].natalTemporalPillarPairSlotCount, 24);
  assert.equal(
    batch.results[0].fixedStateResults[0].temporalMaterialProjectionSet.layerCount,
    6,
  );
  assert.ok(batch.results[0].fixedStateResults[0].temporalMaterialProjectionSet.layers.every(
    (projection) => projection.branch.hiddenStemOccurrences.every(
      (hidden) => hidden.parentBranchOccurrenceRef === projection.branch.occurrenceRef,
    ),
  ));
  assert.equal(batch.results[0].judgmentStatus, 'not_evaluated');
  assert.equal(batch.results[0].causalStatus, 'not_modeled');
  assert.equal(batch.results[0].effectEligible, false);
  assert.match(batch.temporalKernelBatchHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(batch.requestMetadata, { purpose: 'test' });
});

test('inter-temporal compiler retains overlapping pair labels, both punishment directions and complete groups', () => {
  const { candidateSet, request } = inputs([relationRichCandidate()]);
  const batch = compileTemporalRequest(request, candidateSet, natalFixedBundle, RELEASE_CONTEXT);
  const relationSet = batch.results[0].interTemporalRelationSet;
  assert.equal(relationSet.pillarPairCount, 15);
  assert.ok(relationSet.completeGroups.some((group) => group.groupId === 'three_harmony_water'));
  assert.ok(relationSet.completeGroups.some((group) => group.groupId === 'punishment_yin_si_shen'));
  const structural = relationSet.pairs.flatMap((pair) => pair.structuralMatches);
  assert.ok(structural.some((match) => match.directionality === 'directed'
    && match.roleBindings[0].occurrenceRef.includes('minor_luck')));
  assert.ok(structural.some((match) => match.directionality === 'directed'
    && match.roleBindings[0].occurrenceRef.includes('day')));
  assert.ok(structural.some((match) => match.relationRuleId.includes('stem_five_combination')));
  const fixed = batch.results[0].fixedStateResults[0];
  assert.ok(fixed.mixedCompleteGroupSet.groups.every((group) => (
    new Set(group.roleBindings.map((binding) => binding.scope)).size === 2
  )));
});

test('six-layer Zi-Mao punishment emits both source-target bindings', () => {
  const row = candidate();
  row.layers[1] = layer('minor_luck', 'yi', 'mao', true);
  const { candidateSet, request } = inputs([row]);
  const batch = compileTemporalRequest(request, candidateSet, natalFixedBundle, RELEASE_CONTEXT);
  assert.equal(batch.status, 'compiled');
  const matches = batch.results[0].interTemporalRelationSet.pairs.flatMap(p => p.structuralMatches)
    .filter(m => m.relationRuleId === 'bazi.relation_rule.branch_punishment.v1'
      && m.occurrenceRefs.includes('time.major_luck:test.branch')
      && m.occurrenceRefs.includes('time.minor_luck:test.branch'));
  assert.equal(matches.length, 2);
  assert.deepEqual(new Set(matches.map(m => m.roleBindings[0].occurrenceRef)),
    new Set(['time.major_luck:test.branch', 'time.minor_luck:test.branch']));
});

test('temporal total map preserves validation failures and runtime failures', () => {
  const invalid = candidate({ layers: candidate().layers.slice(0, 5) });
  const first = inputs([candidate(), invalid]);
  const partial = compileTemporalRequest(
    first.request,
    first.candidateSet,
    natalFixedBundle,
    RELEASE_CONTEXT,
  );
  assert.equal(partial.inputCount, 2);
  assert.equal(partial.resultCount, 2);
  assert.deepEqual(partial.results.map((result) => result.status), ['compiled', 'validation_failed']);
  assert.equal(partial.status, 'partial_failure');
  assert.equal(partial.results[1].deterministic, true);
  assert.equal(partial.results[1].retryable, false);

  const second = inputs();
  const internal = compileTemporalRequestWithHooks(
    second.request,
    second.candidateSet,
    natalFixedBundle,
    RELEASE_CONTEXT,
    { onPhase(phase) { if (phase === 'candidate_finalization') throw new Error('injected'); } },
  );
  assert.equal(internal.status, 'failed');
  assert.equal(internal.results[0].status, 'internal_error');
  assert.equal(internal.results[0].retryable, true);
  assert.equal(internal.results[0].deterministic, false);

  const nullFailure = compileTemporalRequestWithHooks(
    second.request,
    second.candidateSet,
    natalFixedBundle,
    RELEASE_CONTEXT,
    { onPhase(phase) { if (phase === 'candidate_finalization') throw null; } },
  );
  assert.equal(nullFailure.results[0].diagnostics.errorName, 'Error');
  assert.equal(nullFailure.results[0].diagnostics.message, 'null');

  const deterministicFailure = compileTemporalRequestWithHooks(
    second.request,
    second.candidateSet,
    natalFixedBundle,
    RELEASE_CONTEXT,
    { onPhase(phase) { if (phase === 'inter_temporal_relation_compilation') throw new TypeError('injected'); } },
  );
  assert.equal(deterministicFailure.results[0].status, 'compilation_failed');

  const messageLessTypeError = new TypeError('temporary');
  Object.defineProperty(messageLessTypeError, 'message', { value: null });
  const deterministicFallback = compileTemporalRequestWithHooks(
    second.request,
    second.candidateSet,
    natalFixedBundle,
    RELEASE_CONTEXT,
    { onPhase(phase) { if (phase === 'inter_temporal_relation_compilation') throw messageLessTypeError; } },
  );
  assert.equal(deterministicFallback.results[0].status, 'compilation_failed');
});

test('temporal candidate validation closes every identity, grammar and interval boundary', () => {
  const variants = [];
  const add = (mutate) => {
    const value = structuredClone(candidate());
    mutate(value);
    variants.push(value);
  };
  add((value) => { value.version = 'unsupported'; });
  add((value) => { value.subjectRef = 'subject:other'; });
  add((value) => { value.targetInstantMs = 1.5; });
  add((value) => { value.layers[0].layerId = 'unsupported'; });
  add((value) => { value.layers[2].subjectRef = subjectRef; });
  add((value) => { value.layers[2].stemId = 'unknown'; });
  add((value) => { value.layers[0].validUntilMs = value.layers[0].validFromMs; });
  add((value) => { value.layers[1].stemOccurrenceId = value.layers[0].stemOccurrenceId; });
  add((value) => { value.layers[1].layerId = 'major_luck'; });
  add((value) => { value.layers[3].stemId = 'wu'; });
  add((value) => { value.layers[5].stemId = 'jia'; });
  add((value) => { value.layers[0].sourceRefs = 'not-an-array'; });
  add((value) => { value.provenanceRefs = []; });
  const { candidateSet, request } = inputs(variants);
  const batch = compileTemporalRequest(request, candidateSet, natalFixedBundle, RELEASE_CONTEXT);
  assert.equal(batch.resultCount, variants.length);
  assert.ok(batch.results.every((result) => result.status === 'validation_failed'));
  assert.equal(batch.status, 'failed');
});

test('temporal collection builders and captures reject malformed wrappers deterministically', () => {
  assert.throws(() => buildTemporalLayerCandidateSetV1({
    version: 'unsupported', subjectRef, candidates: [], provenanceRefs: ['p'],
  }), /version/);
  assert.throws(() => buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef,
    candidates: {},
    provenanceRefs: ['p'],
  }), /must be an array/);
  assert.throws(() => buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef,
    candidates: [],
    provenanceRefs: [],
  }), /must not be empty/);

  const { candidateSet, request } = inputs([candidate(), candidate()]);
  assert.deepEqual(
    captureTemporalLayerCandidateSetV1(JSON.stringify(candidateSet)),
    candidateSet,
  );
  assert.deepEqual(
    captureTemporalKernelRequestV1(new TextEncoder().encode(JSON.stringify(request))),
    request,
  );

  const wrongVersion = structuredClone(candidateSet);
  wrongVersion.candidates[0].version = 'unsupported';
  assert.throws(() => captureTemporalLayerCandidateSetV1(wrongVersion), /version/);
  const wrongEnvelopeHash = structuredClone(candidateSet);
  wrongEnvelopeHash.candidates[0].candidateEnvelopeHash = 'sha256:'.padEnd(71, '0');
  assert.throws(() => captureTemporalLayerCandidateSetV1(wrongEnvelopeHash), /candidateEnvelopeHash/);
  const malformed = structuredClone(candidateSet);
  malformed.candidateCount = 1;
  assert.throws(() => captureTemporalLayerCandidateSetV1(malformed), /malformed/);

  const negativeOrdinal = structuredClone(candidateSet);
  negativeOrdinal.candidates[0].candidateOrdinal = -1;
  negativeOrdinal.candidates[0] = rehash(
    negativeOrdinal.candidates[0],
    'candidateEnvelopeHash',
    'bazi.temporal_candidate_envelope.v1',
  );
  assert.throws(() => captureTemporalLayerCandidateSetV1(negativeOrdinal), /safe integer/);

  const wrongOrdinal = structuredClone(candidateSet);
  wrongOrdinal.candidates[0].candidateOrdinal = 1;
  wrongOrdinal.candidates[0] = rehash(
    wrongOrdinal.candidates[0],
    'candidateEnvelopeHash',
    'bazi.temporal_candidate_envelope.v1',
  );
  wrongOrdinal.temporalLayerCandidateSetHash = rehash(
    wrongOrdinal,
    'temporalLayerCandidateSetHash',
    'bazi.temporal_layer_candidate_set.v1',
  ).temporalLayerCandidateSetHash;
  assert.throws(() => captureTemporalLayerCandidateSetV1(wrongOrdinal), /ordinals/);

  const duplicateId = structuredClone(candidateSet);
  duplicateId.candidates[1].temporalCandidateId = duplicateId.candidates[0].temporalCandidateId;
  duplicateId.candidates[1] = rehash(
    duplicateId.candidates[1],
    'candidateEnvelopeHash',
    'bazi.temporal_candidate_envelope.v1',
  );
  duplicateId.temporalLayerCandidateSetHash = rehash(
    duplicateId,
    'temporalLayerCandidateSetHash',
    'bazi.temporal_layer_candidate_set.v1',
  ).temporalLayerCandidateSetHash;
  assert.throws(() => captureTemporalLayerCandidateSetV1(duplicateId), /unique/);

  const wrongSetHash = structuredClone(candidateSet);
  wrongSetHash.temporalLayerCandidateSetHash = 'sha256:'.padEnd(71, '0');
  assert.throws(() => captureTemporalLayerCandidateSetV1(wrongSetHash), /hash/);
  assert.throws(() => buildTemporalKernelRequestV1({
    version: 'unsupported',
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
  }), /version/);
  assert.throws(() => buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: 'not-a-hash',
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
    subjectRef,
    targetRangeRef: 'range',
    provenanceRefs: ['p'],
  }), /sha256/);
});

test('empty and natal-unavailable batches remain explicit', () => {
  const empty = inputs([]);
  const emptyBatch = compileTemporalRequest(
    empty.request,
    empty.candidateSet,
    natalFixedBundle,
    RELEASE_CONTEXT,
  );
  assert.equal(emptyBatch.status, 'empty');
  assert.equal(Object.hasOwn(emptyBatch, 'requestMetadata'), true);

  const unavailableBundle = structuredClone(natalFixedBundle);
  unavailableBundle.fixedStatesByHash = {};
  unavailableBundle.distinctFixedStateCount = 0;
  unavailableBundle.pathBindings = unavailableBundle.pathBindings.map((binding) => rehash({
    ...binding,
    compilationStatus: 'validation_failed',
    fixedStateRef: null,
    sourceProjectionDerivations: [],
  }, 'pathBindingHash', 'bazi.natal_fixed_path_binding.v1'));
  const capturedUnavailableBundle = rehash(
    unavailableBundle,
    'bundleHash',
    'bazi.natal_fixed_bundle.v1',
  );
  const candidateSet = buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef,
    candidates: [{
      temporalCandidateId: 'temporal-candidate:unavailable',
      calendarDecisionPathRef: 'temporal-calendar-path:unavailable',
      candidate: candidate(),
    }],
    provenanceRefs: ['p'],
  });
  const request = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: capturedUnavailableBundle.bundleHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
    subjectRef,
    targetRangeRef: 'range:unavailable',
    provenanceRefs: ['p'],
  });
  const batch = compileTemporalRequest(
    request,
    candidateSet,
    capturedUnavailableBundle,
    RELEASE_CONTEXT,
  );
  assert.equal(batch.results[0].status, 'natal_unavailable');
});

test('multiple distinct natal fixed states are canonically ordered and each compiled once', () => {
  const alternateInput = JSON.parse(input);
  alternateInput.birth.input.local = '2000-07-19T10:00:00';
  const alternateRun = spawnSync(process.execPath, ['tools/compile-birth.mjs'], {
    cwd: root,
    input: JSON.stringify(alternateInput),
    encoding: 'utf8',
  });
  assert.equal(alternateRun.status, 0, alternateRun.stderr);
  const alternate = JSON.parse(alternateRun.stdout);
  const merged = structuredClone(natalFixedBundle);
  merged.fixedStatesByHash = {
    ...merged.fixedStatesByHash,
    ...alternate.fixedStatesByHash,
  };
  merged.distinctFixedStateCount = Object.keys(merged.fixedStatesByHash).length;
  merged.pathBindings = [...merged.pathBindings, ...alternate.pathBindings];
  merged.pathCount = merged.pathBindings.length;
  const mergedBundle = rehash(merged, 'bundleHash', 'bazi.natal_fixed_bundle.v1');
  const candidateSet = buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef,
    candidates: [{
      temporalCandidateId: 'temporal-candidate:multi-state',
      calendarDecisionPathRef: 'temporal-calendar-path:multi-state',
      candidate: candidate(),
    }],
    provenanceRefs: ['p'],
  });
  const request = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: mergedBundle.bundleHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
    subjectRef,
    targetRangeRef: 'range:multi-state',
    provenanceRefs: ['p'],
  });
  const batch = compileTemporalRequest(request, candidateSet, mergedBundle, RELEASE_CONTEXT);
  assert.equal(batch.results[0].fixedStateResultCount, merged.distinctFixedStateCount);
  const hashes = batch.results[0].fixedStateResults.map((result) => result.fixedStateHash);
  assert.deepEqual(hashes, [...hashes].sort());
});

test('temporal collection identity fails before total-map execution', () => {
  const { candidateSet, request } = inputs();
  const otherValid = inputs([relationRichCandidate()]);
  assert.throws(
    () => compileTemporalRequest(request, otherValid.candidateSet, natalFixedBundle, RELEASE_CONTEXT),
    /hash references/,
  );
  const drifted = { ...request, subjectRef: 'subject:other' };
  assert.throws(
    () => compileTemporalRequest(drifted, candidateSet, natalFixedBundle, RELEASE_CONTEXT),
    /requestHash/,
  );
  const wrongHash = { ...candidateSet, temporalLayerCandidateSetHash: 'sha256:'.padEnd(71, '0') };
  assert.throws(
    () => compileTemporalRequest(request, wrongHash, natalFixedBundle, RELEASE_CONTEXT),
    /hash/,
  );

  const otherSet = buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef: 'subject:other',
    candidates: [],
    provenanceRefs: ['p'],
  });
  const otherRequest = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: natalFixedBundle.bundleHash,
    temporalLayerCandidateSetHash: otherSet.temporalLayerCandidateSetHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
    subjectRef: 'subject:other',
    targetRangeRef: 'range:other',
    provenanceRefs: ['p'],
  });
  assert.throws(
    () => compileTemporalRequest(otherRequest, otherSet, natalFixedBundle, RELEASE_CONTEXT),
    /subjectRef/,
  );

  const driftedBundle = structuredClone(natalFixedBundle);
  driftedBundle.release.selectedRelationProfileHash = 'sha256:'.padEnd(71, '0');
  const capturedDriftedBundle = rehash(driftedBundle, 'bundleHash', 'bazi.natal_fixed_bundle.v1');
  const driftRequest = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: capturedDriftedBundle.bundleHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
    subjectRef,
    targetRangeRef: 'range:drift',
    provenanceRefs: ['p'],
  });
  assert.throws(
    () => compileTemporalRequest(driftRequest, candidateSet, capturedDriftedBundle, RELEASE_CONTEXT),
    /selected admitted release/,
  );
});
