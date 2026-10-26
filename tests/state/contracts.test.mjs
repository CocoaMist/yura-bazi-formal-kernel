import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBranchKey,
  buildEffect,
  buildFact,
  buildFormalState,
  buildInteraction,
  buildMetricInstanceKey,
  buildMetricValue,
} from '../../src/index.mjs';
import { buildStateDelta } from '../../src/state/contracts.mjs';
import { STATE_SCOPE, targetKey } from '../helpers.mjs';

test('Fact captures nested JSON without aliasing, flattening arrays or invoking accessors', () => {
  const make = value => buildFact({ factId: 'fact:captured', ...STATE_SCOPE,
    subjectRef: 'subject:test:1', predicate: 'bazi.test.capture', value, validTimeRef: 'time:test:natal' });
  const input = { nested: { n: 1 }, items: [{ n: 2 }] };
  const fact = make(input);
  input.nested.n = 9; input.items[0].n = 9;
  assert.deepEqual(fact.value, { nested: { n: 1 }, items: [{ n: 2 }] });
  assert.throws(() => { fact.value.items[0].n = 3; }, TypeError);
  assert.deepEqual(make([1, { n: 2 }]).value, [1, { n: 2 }]);
  assert.equal(make(null).value, null);
  let reads = 0;
  const accessor = Object.defineProperty({}, 'n', { get() { reads++; return 1; } });
  assert.throws(() => make({ nested: accessor }), /own data property/);
  assert.equal(reads, 0);
  assert.throws(() => make(new Date()), /plain JSON object/);
});

test('formal state validates collection shape, scope, uniqueness and canonical order', () => {
  const zKey = targetKey({ metricId: 'bazi.test.z' });
  const aKey = targetKey({ metricId: 'bazi.test.a' });
  const state = buildFormalState({
    stateId: 'state:contracts',
    ...STATE_SCOPE,
    snapshotRef: 'snapshot:contracts',
    metrics: [
      { key: zKey, value: { value: 'high', valueStatus: 'known' } },
      { key: aKey, value: { value: 'low', valueStatus: 'known' } },
    ],
  });
  assert.equal(state.snapshotRef, 'snapshot:contracts');
  assert.ok(state.metrics[0].key.keyHash < state.metrics[1].key.keyHash);

  assert.throws(() => buildFormalState({
    stateId: 'state:not-array', ...STATE_SCOPE, metrics: {},
  }), /metrics must be an array/);
  assert.throws(() => buildFormalState({
    stateId: 'state:missing-entry', ...STATE_SCOPE, metrics: [{}],
  }), /requires key and value/);
  assert.throws(() => buildFormalState({
    stateId: 'state:duplicate',
    ...STATE_SCOPE,
    metrics: [
      { key: aKey, value: { value: 'low', valueStatus: 'known' } },
      { key: aKey, value: { value: 'high', valueStatus: 'known' } },
    ],
  }), /duplicate metric instance/);
});

test('Fact, Interaction, Effect and StateDelta reject incomplete mutation chains', () => {
  const primitiveFact = buildFact({
    factId: 'fact:primitive',
    ...STATE_SCOPE,
    subjectRef: 'subject:test:1',
    predicate: 'bazi.test.primitive',
    value: 1,
    validTimeRef: 'time:test:natal',
    evidenceRefs: ['evidence:1'],
    provenanceRef: 'source:1',
  });
  assert.equal(primitiveFact.value, 1);
  assert.throws(() => buildFact({}), /value is required/);

  const baseInteraction = {
    interactionId: 'interaction:contracts',
    ...STATE_SCOPE,
    kind: 'bazi.test.contracts',
    participantRefs: [primitiveFact.factId],
    derivedFrom: [primitiveFact.factId],
    verdict: 'satisfied',
    validTimeRef: primitiveFact.validTimeRef,
  };
  assert.equal(buildInteraction(baseInteraction).verdict, 'satisfied');
  assert.throws(
    () => buildInteraction({ ...baseInteraction, participantRefs: [] }),
    /requires participants and derivedFrom/,
  );
  assert.throws(
    () => buildInteraction({ ...baseInteraction, derivedFrom: [] }),
    /requires participants and derivedFrom/,
  );

  const baseEffect = {
    effectId: 'effect:contracts',
    ...STATE_SCOPE,
    targetKey: targetKey({ contextRef: 'context:contracts' }),
    activation: { status: 'active', degreePpm: 1_000_000 },
    operation: 'increase',
    magnitude: 'low',
    confidence: 'medium',
    causes: [baseInteraction.interactionId],
    contributionRef: 'contribution:1',
  };
  assert.equal(buildEffect(baseEffect).contributionRef, 'contribution:1');
  assert.throws(() => buildEffect({ ...baseEffect, causes: [] }), /at least one reference/);

  assert.throws(() => buildStateDelta({ changes: null }), /changes must be an array/);
  const deltaInput = {
    transitionId: 'transition:contracts',
    branchKey: STATE_SCOPE.branchKey,
    resolverId: 'canonical_resolver',
    resolverVersion: 'canonical_resolver_v3',
    previousStateRef: 'state:prior',
    previousStateHash: `sha256:${'a'.repeat(64)}`,
    nextStateRef: 'state:next',
    nextStateHash: `sha256:${'b'.repeat(64)}`,
    changes: [{ target: 'metric:1' }],
  };
  const delta = buildStateDelta(deltaInput);
  assert.equal(delta.version, 'formal.state_delta.v3');
  assert.deepEqual(delta.blocked, []);
  assert.deepEqual(delta.unchanged, []);
  assert.equal(Object.isFrozen(delta.changes[0]), true);
  assert.match(delta.provenanceRoot, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => buildStateDelta({ ...deltaInput, unchanged: null }), /unchanged must be an array/);
  assert.throws(() => buildStateDelta({ ...deltaInput, blocked: null }), /blocked must be an array/);
  assert.throws(
    () => buildStateDelta({ ...deltaInput, previousStateHash: '' }),
    /previousStateHash must be a non-empty string/,
  );
});

test('BranchKey is content-addressed and cannot be forged or partially declared', () => {
  const key = buildBranchKey({
    system: 'bazi',
    laneId: 'bazi.foundation.v1',
    ruleProfileId: 'bazi.school.none.v1',
    methodId: 'bazi.method.none.v1',
    evidencePolicyId: 'bazi.evidence.none.v1',
    resolverPolicyId: 'bazi.resolver.canonical.v3',
  });
  assert.equal(key.version, 'formal.branch_key.v1');
  assert.match(key.branchHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(buildBranchKey(key).branchHash, key.branchHash);
  assert.notEqual(
    buildBranchKey({ ...key, branchHash: undefined, methodId: 'bazi.method.other.v1' }).branchHash,
    key.branchHash,
  );
  assert.throws(
    () => buildBranchKey({ ...key, branchHash: `sha256:${'0'.repeat(64)}` }),
    /branchHash does not match/,
  );
  assert.throws(
    () => buildBranchKey({ ...key, version: 'formal.branch_key.v0' }),
    /version must be formal\.branch_key\.v1/,
  );
  assert.throws(() => buildBranchKey({ ...key, methodId: null }), /methodId must be a non-empty string/);
  assert.throws(() => buildBranchKey({ ...key, extra: 1 }), /unknown fields: extra/);
});

test('metric values and empty builder defaults fail closed', () => {
  assert.deepEqual(buildMetricValue({ valueStatus: 'unknown' }), {
    value: null, valueStatus: 'unknown',
  });
  assert.throws(() => buildMetricValue({ value: 'invalid', valueStatus: 'known' }), /must be one of/);
  assert.throws(() => buildMetricValue(), /MetricValue.valueStatus/);
  assert.throws(() => buildMetricInstanceKey(), /BranchKey.system must be a non-empty string/);
});

test('metric identity boundary rejects accessors without invoking them', () => {
  let invoked = false;
  const unsafe = { ...targetKey() };
  Object.defineProperty(unsafe, 'metricId', {
    enumerable: true,
    get() {
      invoked = true;
      return 'bazi.test.unsafe';
    },
  });
  assert.throws(() => buildMetricInstanceKey(unsafe), /must be an own data property/);
  assert.equal(invoked, false);
});
