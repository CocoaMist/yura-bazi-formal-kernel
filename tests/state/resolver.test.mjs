import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivation,
  buildCanonicalEffectOpSet,
  buildEffect,
  buildFact,
  buildFormalState,
  buildFormalStateSet,
  buildInteraction,
  buildMetricInstanceKey,
  buildMetricValue,
  canonicalJsonV1,
  contentHashV1,
  resolveEffects as resolveEffectsV041,
} from '../../src/index.mjs';
import { assertLaneMayMutate } from '../../src/systems/boundary.mjs';
import {
  branchKey,
  RUN_REF,
  STATE_SCOPE,
  targetKey,
} from '../helpers.mjs';

function resolveEffects(priorState, effects, options = {}) {
  const branchKeyValue = options.branchKey ?? priorState?.branchKey ?? STATE_SCOPE.branchKey;
  const effectOpSet = Array.isArray(effects)
    ? buildCanonicalEffectOpSet({ branchKey: branchKeyValue, effects })
    : effects;
  return resolveEffectsV041(priorState, effectOpSet, {
    ...options,
    branchKey: branchKeyValue,
    resolverVersion: options.resolverVersion ?? 'canonical_resolver_v3',
  });
}

function state(value = 'moderate', status = 'known', key = targetKey(), scope = STATE_SCOPE) {
  return buildFormalState({
    stateId: 'state:test:0',
    ...scope,
    metrics: [{ key, value: buildMetricValue({ value: status === 'unknown' ? null : value, valueStatus: status }) }],
  });
}

function effect(effectId, operation, magnitude = 'low', key = targetKey(), scope = STATE_SCOPE, activation = { status: 'active', degreePpm: 1_000_000 }) {
  return buildEffect({
    effectId,
    ...scope,
    targetKey: key,
    activation,
    operation,
    magnitude,
    confidence: 'medium',
    causes: [`interaction:${effectId}`],
  });
}

function resolve(priorState, effects, transitionId, extra = {}) {
  return resolveEffects(priorState, effects, {
    transitionId,
    previousStateHash: priorState.stateHash,
    ...extra,
  });
}

test('blocked operations never poison the applied-interaction replay ledger', () => {
  const increase = effect('effect:retry', 'increase');
  const blocked = resolve(state(null, 'unknown'), [increase], 'transition:blocked');
  assert.deepEqual(blocked.stateDelta.operationRefs, []);
  assert.deepEqual(blocked.stateDelta.interactionRefs, []);
  assert.equal(blocked.stateDelta.blocked[0].reason, 'unknown_baseline');
  const retried = resolve(state('low'), [increase], 'transition:retry', {
    appliedInteractionRefs: blocked.stateDelta.interactionRefs,
  });
  assert.equal(retried.nextState.metrics[0].value.value, 'moderate');
  assert.deepEqual(retried.stateDelta.interactionRefs, ['interaction:effect:retry']);
  assert.throws(() => resolve(retried.nextState, [increase], 'transition:duplicate', {
    appliedInteractionRefs: retried.stateDelta.interactionRefs,
  }), /already applied/);
  const mixed = resolve(state(), [increase, effect('effect:unknown', 'set_unknown')], 'transition:mixed');
  assert.equal(mixed.stateDelta.blocked[0].reason, 'mixed_set_unknown_operation');
  assert.deepEqual(mixed.stateDelta.interactionRefs, []);
});

test('net-zero and clamped operations still consume their interactions', () => {
  const cancelled = resolve(state(), [effect('plus', 'increase'), effect('minus', 'decrease')], 'cancelled');
  assert.equal(cancelled.stateDelta.unchanged[0].reason, 'net_zero_operation');
  assert.deepEqual(cancelled.stateDelta.interactionRefs, ['interaction:minus', 'interaction:plus']);
  const clamped = resolve(state('high'), [effect('plus', 'increase')], 'clamped');
  assert.equal(clamped.stateDelta.unchanged[0].reason, 'clamped_no_change');
  assert.deepEqual(clamped.stateDelta.interactionRefs, ['interaction:plus']);
});

test('public contracts reject malformed activation, identity, scope and canonical values', () => {
  assert.deepEqual(buildActivation({ status: 'active', degreePpm: 1 }), {
    status: 'active', degreePpm: 1,
  });
  assert.throws(() => buildActivation({ status: 'active', degreePpm: 0 }), /integer degreePpm/);
  assert.throws(() => buildActivation({ status: 'active', degreePpm: 1.5 }), /integer degreePpm/);
  assert.throws(() => buildActivation({ status: 'active', degreePpm: 1_000_001 }), /integer degreePpm/);
  assert.throws(() => buildActivation({ status: 'inactive', degreePpm: 1 }), /requires degreePpm=0/);
  assert.throws(() => buildActivation({ status: 'unknown', degreePpm: 0 }), /requires degreePpm=null/);

  assert.throws(() => buildMetricInstanceKey({
    ...targetKey(),
    metricId: 'liuyao.test.pressure',
  }), /outside system namespace/);

  const otherBranchKey = targetKey({ branchKey: branchKey({ ruleProfileId: 'bazi.school.other.v1' }) });
  assert.throws(() => buildFormalState({
    stateId: 'state:scope-mismatch',
    ...STATE_SCOPE,
    metrics: [{
      key: otherBranchKey,
      value: { value: 'moderate', valueStatus: 'known' },
    }],
  }), /metric instance scope/);
  assert.throws(() => buildEffect({
    effectId: 'effect:scope-mismatch',
    ...STATE_SCOPE,
    targetKey: otherBranchKey,
    activation: { status: 'active', degreePpm: 1_000_000 },
    operation: 'increase',
    magnitude: 'low',
    confidence: 'medium',
    causes: ['interaction:scope-mismatch'],
  }), /target scope/);

  assert.equal(assertLaneMayMutate('bazi.foundation.v1', 'bazi.test.pressure'), true);
  assert.throws(
    () => assertLaneMayMutate('bazi.school.other.v1', 'bazi.test.pressure'),
    /may not mutate namespace/,
  );
assert.throws(() => canonicalJsonV1(undefined), /canonical JSON must be JSON data/);
assert.throws(() => canonicalJsonV1(Number.NaN), /canonical JSON must be finite JSON data/);
  assert.throws(
    () => resolveEffects(null, [], {
      transitionId: 'transition:missing-state',
      previousStateHash: 'sha256:none',
    }),
    /FormalState required/,
  );
  assert.throws(
    () => resolve(state(), {}, 'transition:bad-effects'),
    /effects must be an array/,
  );
  assert.throws(
    () => buildCanonicalEffectOpSet({ version: 'bad', branchKey: STATE_SCOPE.branchKey, effects: [] }),
    /version must be/,
  );
  const emptySet = buildCanonicalEffectOpSet({ branchKey: STATE_SCOPE.branchKey, effects: [] });
  assert.throws(
    () => buildCanonicalEffectOpSet({ ...emptySet, effectOpSetHash: `sha256:${'0'.repeat(64)}` }),
    /effectOpSetHash/,
  );
});

test('canonical resolver applies one deterministic StateDelta path', () => {
  const priorState = state();
  const candidateEffect = effect('effect:1', 'increase');
  const result = resolve(priorState, [candidateEffect], 'transition:1');
  assert.equal(result.nextState.metrics[0].value.value, 'elevated');
  assert.equal(result.stateDelta.changes.length, 1);
  assert.equal(result.stateDelta.changes[0].clamped, false);
  assert.equal(priorState.version, 'formal.state_contract.v2');
  assert.equal(result.stateDelta.version, 'formal.state_delta.v3');
  assert.equal(result.stateDelta.resolverId, 'canonical_resolver');
  assert.equal(result.stateDelta.resolverVersion, 'canonical_resolver_v3');
  assert.equal(result.authority, 'candidate');
  assert.equal(result.admissionStatus, 'candidate');
  assert.equal(priorState.authority, 'candidate');
  assert.equal(candidateEffect.authority, 'candidate');
  assert.equal(result.nextState.authority, 'candidate');
  assert.equal(result.stateDelta.authority, 'candidate');
  assert.equal(result.semanticHash, contentHashV1({
    authority: 'candidate',
    admissionStatus: 'candidate',
    nextState: result.nextState,
    stateDelta: result.stateDelta,
  }));
});

test('StateDelta binds the prior state, the operations and the branch it was computed in', () => {
  const priorState = state();
  const result = resolve(priorState, [effect('effect:bound', 'increase')], 'transition:bound');
  const { stateDelta } = result;
  assert.equal(stateDelta.previousStateHash, priorState.stateHash);
  assert.equal(stateDelta.nextStateHash, result.nextState.stateHash);
  assert.equal(stateDelta.previousStateRef, priorState.stateId);
  assert.equal(stateDelta.nextStateRef, result.nextState.stateId);
  assert.deepEqual(stateDelta.operationRefs, ['effect:bound']);
  assert.deepEqual(stateDelta.interactionRefs, ['interaction:effect:bound']);
  assert.equal(stateDelta.branchKey.branchHash, priorState.branchKey.branchHash);
  assert.equal(stateDelta.beforeValues[0].value.value, 'moderate');
  assert.equal(stateDelta.afterValues[0].value.value, 'elevated');
  assert.equal(typeof stateDelta.provenanceRoot, 'string');
  assert.notEqual(priorState.stateHash, result.nextState.stateHash);
});

test('resolver rejects a prior state it was not asked to advance', () => {
  const priorState = state();
  assert.throws(
    () => resolveEffects(priorState, [], {
      transitionId: 'transition:wrong-prior',
      previousStateHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    }),
    /previousStateHash does not match/,
  );
  assert.throws(
    () => resolveEffects(priorState, [], { transitionId: 'transition:no-prior' }),
    /previousStateHash must be a non-empty string/,
  );
});

test('resolver requires explicit canonical effect set, branch and resolver version', () => {
  const priorState = state();
  const set = buildCanonicalEffectOpSet({
    branchKey: priorState.branchKey,
    effects: [effect('effect:explicit-inputs', 'increase')],
  });
  assert.match(set.effectOpSetHash, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => resolveEffectsV041(priorState, set, {
    transitionId: 'transition:missing-branch',
    previousStateHash: priorState.stateHash,
    resolverVersion: 'canonical_resolver_v3',
  }), /BranchKey/);
  assert.throws(() => resolveEffectsV041(priorState, set, {
    transitionId: 'transition:bad-resolver',
    previousStateHash: priorState.stateHash,
    branchKey: priorState.branchKey,
    resolverVersion: 'canonical_resolver_v2',
  }), /resolverVersion must be canonical_resolver_v3/);
});

test('resolver rejects non-canonical records and every independent branch boundary', () => {
  const prior = state();
  const set = buildCanonicalEffectOpSet({ branchKey: prior.branchKey, effects: [] });
  const options = {
    transitionId: 'transition:canonical-boundary',
    previousStateHash: prior.stateHash,
    appliedInteractionRefs: [],
    branchKey: prior.branchKey,
    resolverVersion: 'canonical_resolver_v3',
  };
  assert.throws(
    () => resolveEffectsV041({ ...prior, unexpected: true }, set, options),
    /FormalState and metric keys/,
  );
  const { effectOpSetHash: ignoredHash, ...setWithoutHash } = set;
  assert.ok(ignoredHash);
  assert.throws(
    () => resolveEffectsV041(prior, setWithoutHash, options),
    /CanonicalEffectOpSet must match/,
  );
  const otherBranch = branchKey({ ruleProfileId: 'bazi.school.other.v1' });
  assert.throws(
    () => resolveEffectsV041(prior, set, { ...options, branchKey: otherBranch }),
    /resolver branchKey/,
  );
  const otherSet = buildCanonicalEffectOpSet({ branchKey: otherBranch, effects: [] });
  assert.throws(
    () => resolveEffectsV041(prior, otherSet, options),
    /EffectOpSet branchKey/,
  );
  assert.throws(
    () => buildCanonicalEffectOpSet({
      branchKey: prior.branchKey,
      effects: [{ ...effect('effect:extra', 'increase'), unexpected: true }],
    }),
    /canonical identities/,
  );
});

test('an interaction already recorded in the ledger cannot be applied twice', () => {
  const priorState = state();
  assert.throws(
    () => resolve(priorState, [effect('effect:replay', 'increase')], 'transition:replay', {
      appliedInteractionRefs: ['interaction:effect:replay'],
    }),
    /interaction already applied/,
  );
});

test('effect ordering cannot change canonical output', () => {
  const effects = [effect('effect:z', 'increase', 'moderate'), effect('effect:a', 'decrease', 'low')];
  const left = resolve(state(), effects, 'transition:order');
  const right = resolve(state(), [...effects].reverse(), 'transition:order');
  assert.equal(left.semanticHash, right.semanticHash);
  assert.equal(contentHashV1(left), contentHashV1(right));
  assert.deepEqual(left.stateDelta.changes[0].contributorIds, ['effect:a', 'effect:z']);
});

test('next state identity binds the complete effect set', () => {
  const prior = state();
  const increased = resolve(prior, [effect('effect:identity-up', 'increase')], 'transition:same');
  const decreased = resolve(prior, [effect('effect:identity-down', 'decrease')], 'transition:same');
  assert.notEqual(increased.nextState.stateId, decreased.nextState.stateId);
  assert.notEqual(increased.nextState.stateHash, decreased.nextState.stateHash);
});

test('canonical ordering does not depend on the ambient locale', () => {
  // localeCompare would order 'effect:a' before 'effect:B' in most locales and
  // after it by code unit. Canonical order must be the code-unit order.
  const effects = [effect('effect:a', 'increase', 'low'), effect('effect:B', 'increase', 'low')];
  const left = resolve(state(), effects, 'transition:locale');
  const right = resolve(state(), [...effects].reverse(), 'transition:locale');
  assert.deepEqual(left.stateDelta.changes[0].contributorIds, ['effect:B', 'effect:a']);
  assert.equal(left.semanticHash, right.semanticHash);
});

test('blocked effect ordering cannot change canonical output', () => {
  const effects = [
    effect('effect:unknown', 'increase', 'high', targetKey(), STATE_SCOPE, {
      status: 'unknown', degreePpm: null,
    }),
    effect('effect:inactive', 'decrease', 'low', targetKey(), STATE_SCOPE, {
      status: 'inactive', degreePpm: 0,
    }),
  ];
  const left = resolve(state(), effects, 'transition:blocked-order');
  const right = resolve(state(), [...effects].reverse(), 'transition:blocked-order');
  assert.equal(left.semanticHash, right.semanticHash);
  assert.deepEqual(left.stateDelta.blocked, right.stateDelta.blocked);
});

test('admitted effects that cancel out stay in the trace instead of vanishing', () => {
  const net = resolve(state(), [
    effect('effect:up', 'increase', 'moderate'),
    effect('effect:down', 'decrease', 'moderate'),
  ], 'transition:net-zero');
  assert.deepEqual(net.stateDelta.changes, []);
  assert.deepEqual(net.stateDelta.blocked, []);
  assert.equal(net.stateDelta.unchanged.length, 1);
  assert.equal(net.stateDelta.unchanged[0].reason, 'net_zero_operation');
  assert.deepEqual(net.stateDelta.unchanged[0].contributorIds, ['effect:down', 'effect:up']);
  assert.deepEqual(net.stateDelta.operationRefs, ['effect:down', 'effect:up']);
  assert.equal(net.nextState.metrics[0].value.value, 'moderate');

  const absorbed = resolve(state('high'), [effect('effect:over', 'increase', 'high')], 'transition:clamped');
  assert.deepEqual(absorbed.stateDelta.changes, []);
  assert.equal(absorbed.stateDelta.unchanged[0].reason, 'clamped_no_change');
});

test('unknown is metadata and blocks arithmetic until explicitly set', () => {
  const priorState = state(null, 'unknown');
  const blocked = resolve(priorState, [effect('effect:1', 'increase')], 'transition:unknown');
  assert.equal(blocked.nextState.metrics[0].value.value, null);
  assert.equal(blocked.nextState.metrics[0].value.valueStatus, 'unknown');
  assert.equal(blocked.stateDelta.changes.length, 0);
  assert.equal(blocked.stateDelta.blocked[0].reason, 'unknown_baseline');
  assert.throws(() => buildMetricValue({ value: 'unknown', valueStatus: 'unknown' }));
});

test('set_unknown is an explicit state operation', () => {
  const result = resolve(state(), [effect('effect:set-only', 'set_unknown')], 'transition:set-only');
  assert.deepEqual(result.nextState.metrics[0].value, { value: null, valueStatus: 'unknown' });
  assert.equal(result.stateDelta.changes.length, 1);
});

test('Fact, Interaction and Effect contracts keep the typed mutation chain', () => {
  const fact = buildFact({
    factId: 'fact:test:pillar',
    ...STATE_SCOPE,
    subjectRef: 'subject:test:1',
    predicate: 'bazi.pillar.test',
    value: { stemId: 'jia', branchId: 'zi' },
    validTimeRef: 'time:test:natal',
  });
  const interaction = buildInteraction({
    interactionId: 'interaction:test:1',
    ...STATE_SCOPE,
    kind: 'bazi.test.interaction',
    participantRefs: [fact.factId],
    derivedFrom: [fact.factId],
    verdict: 'indeterminate',
    validTimeRef: fact.validTimeRef,
  });
  const typedEffect = buildEffect({
    effectId: 'effect:typed-chain',
    ...STATE_SCOPE,
    targetKey: targetKey(),
    activation: { status: 'active', degreePpm: 1_000_000 },
    operation: 'increase',
    magnitude: 'low',
    confidence: 'medium',
    causes: [interaction.interactionId],
  });
  assert.deepEqual(typedEffect.causes, [interaction.interactionId]);
  assert.throws(() => buildFact({ ...fact, predicate: 'liuyao.pillar.test' }), /outside system namespace/);
  assert.throws(() => buildInteraction({
    ...interaction,
    kind: 'liuyao.test.interaction',
  }), /outside system namespace/);
  assert.throws(() => buildEffect({
    ...typedEffect,
    causes: [fact.factId],
  }), /must reference Interaction/);
});

test('unknown or partial activation never mutates formal state', () => {
  const unknownEffect = effect(
    'effect:unknown-activation', 'increase', 'high', targetKey(), STATE_SCOPE,
    { status: 'unknown', degreePpm: null },
  );
  const partialEffect = effect(
    'effect:partial-activation', 'increase', 'high', targetKey(), STATE_SCOPE,
    { status: 'active', degreePpm: 500_000 },
  );
  const result = resolve(state(), [unknownEffect, partialEffect], 'transition:activation');
  assert.equal(result.stateDelta.changes.length, 0);
  assert.deepEqual(result.stateDelta.blocked.map((row) => row.reason).sort(), [
    'partial_activation_not_admitted_v1', 'unknown_activation',
  ]);
  assert.throws(() => buildEffect({
    ...effect('effect:bad-activation', 'increase'),
    activation: { status: 'unknown', degreePpm: 0 },
  }));
});

test('mixed set_unknown and arithmetic operations fail closed', () => {
  const result = resolve(state(), [
    effect('effect:set-unknown', 'set_unknown'),
    effect('effect:increase', 'increase'),
  ], 'transition:mixed-set');
  assert.equal(result.stateDelta.changes.length, 0);
  assert.equal(result.stateDelta.blocked[0].reason, 'mixed_set_unknown_operation');
});

test('ordinal operations clamp at boundaries and reject undeclared targets', () => {
  const upper = resolve(state('elevated'), [effect('effect:upper', 'increase', 'high')], 'transition:upper');
  const lower = resolve(state('low'), [effect('effect:lower', 'decrease', 'high')], 'transition:lower');
  assert.equal(upper.nextState.metrics[0].value.value, 'high');
  assert.equal(upper.stateDelta.changes[0].clamped, true);
  assert.equal(lower.nextState.metrics[0].value.value, 'baseline');

  const undeclaredKey = targetKey({ metricId: 'bazi.test.undeclared' });
  assert.throws(() => resolve(
    state(),
    [effect('effect:undeclared', 'increase', 'low', undeclaredKey)],
    'transition:undeclared',
  ), /undeclared/);
});

test('branch, run and lane scopes cannot be folded together', () => {
  const otherBranch = branchKey({ ruleProfileId: 'bazi.school.blind_candidate.v1' });
  const otherScope = { branchKey: otherBranch, runRef: RUN_REF };
  const otherKey = buildMetricInstanceKey({ ...targetKey(), ...otherScope });
  const otherEffect = effect('effect:other-branch', 'increase', 'low', otherKey, otherScope);
  assert.throws(
    () => resolve(state(), [otherEffect], 'transition:branch'),
    /effect branchKey does not match state branchKey|effect branch does not match set branch/,
  );

  const otherRunScope = { branchKey: STATE_SCOPE.branchKey, runRef: 'run:test:2' };
  const otherRunKey = buildMetricInstanceKey({ ...targetKey(), ...otherRunScope });
  const otherRunEffect = effect('effect:other-run', 'increase', 'low', otherRunKey, otherRunScope);
  assert.throws(
    () => resolve(state(), [otherRunEffect], 'transition:run'),
    /effect scope does not match state scope/,
  );

  const forbiddenBranch = branchKey({ laneId: 'liuyao.foundation.v1' });
  const forbiddenScope = { branchKey: forbiddenBranch, runRef: RUN_REF };
  const forbiddenKey = buildMetricInstanceKey({ ...targetKey(), ...forbiddenScope });
  const forbiddenState = state('moderate', 'known', forbiddenKey, forbiddenScope);
  assert.throws(
    () => resolve(forbiddenState, [], 'transition:cross'),
    /closed Bazi foundation lane/,
  );
});

test('branch results stay a set and are never blended into one state', () => {
  const left = state();
  const rightBranch = branchKey({ ruleProfileId: 'bazi.school.other.v1' });
  const rightScope = { branchKey: rightBranch, runRef: RUN_REF };
  const right = state('high', 'known', buildMetricInstanceKey({ ...targetKey(), ...rightScope }), rightScope);
  const set = buildFormalStateSet({ setId: 'stateset:test', states: [right, left] });
  assert.equal(set.states.length, 2);
  assert.deepEqual(set.branchHashes, set.states.map((entry) => entry.branchKey.branchHash));
  assert.notEqual(set.branchHashes[0], set.branchHashes[1]);
  assert.throws(
    () => buildFormalStateSet({ setId: 'stateset:duplicate', states: [left, left] }),
    /duplicate branch in FormalStateSet/,
  );
  assert.throws(() => buildFormalStateSet({ setId: 'stateset:bad', states: {} }), /must be an array/);
});

test('caller cannot inject a registry to widen mutation authority', () => {
  assert.throws(
    () => resolve(state(), [effect('effect:registry-bypass', 'increase')], 'transition:registry-bypass', {
      registry: {
        'liuyao.foundation.v1': { formalMutation: true, mutationNamespaces: ['bazi'] },
      },
    }),
    /unknown fields: registry/,
  );
});

test('forged operation and target-key identity fail closed', () => {
  const valid = effect('effect:canonical', 'increase');
  assert.throws(
    () => resolve(state(), [{ ...valid, operation: 'multiply' }], 'transition:invalid-operation'),
    /Effect.operation/,
  );
  assert.throws(
    () => resolve(state(), [{
      ...valid,
      targetKey: { ...valid.targetKey, metricId: 'bazi.test.forged' },
    }], 'transition:forged-key'),
    /canonical identities/,
  );
});

test('candidate authority cannot be stripped or forged across resolver boundaries', () => {
  const candidateState = state();
  const candidateEffect = effect('effect:candidate-authority', 'increase');
  const {
    authority: stateAuthority,
    admissionStatus: stateAdmissionStatus,
    ...strippedState
  } = candidateState;
  const {
    authority: effectAuthority,
    admissionStatus: effectAdmissionStatus,
    ...strippedEffect
  } = candidateEffect;
  assert.equal(stateAuthority, 'candidate');
  assert.equal(stateAdmissionStatus, 'candidate');
  assert.equal(effectAuthority, 'candidate');
  assert.equal(effectAdmissionStatus, 'candidate');
  assert.throws(
    () => resolveEffects(strippedState, [candidateEffect], {
      transitionId: 'transition:stripped-state',
      previousStateHash: candidateState.stateHash,
    }),
    /canonical identities/,
  );
  assert.throws(
    () => resolve(candidateState, [strippedEffect], 'transition:stripped-effect'),
    /canonical identities/,
  );
  assert.throws(
    () => resolveEffects(
      { ...candidateState, authority: 'admitted', admissionStatus: 'admitted' },
      [candidateEffect],
      { transitionId: 'transition:forged-state-authority', previousStateHash: candidateState.stateHash },
    ),
    /canonical identities/,
  );
  assert.throws(
    () => resolve(
      candidateState,
      [{ ...candidateEffect, authority: 'admitted', admissionStatus: 'admitted' }],
      'transition:forged-effect-authority',
    ),
    /canonical identities/,
  );
});

test('duplicate effect IDs fail closed', () => {
  const duplicate = effect('effect:duplicate', 'increase');
  assert.throws(
    () => resolve(state(), [duplicate, duplicate], 'transition:duplicate'),
    /duplicate effectId/,
  );
});
