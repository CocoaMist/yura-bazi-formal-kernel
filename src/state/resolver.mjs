import {
  buildEffect,
  buildBranchKey,
  buildCanonicalEffectOpSet,
  buildFormalState,
  buildMetricValue,
  buildStateDelta,
  EFFECT_MAGNITUDE_STEPS,
  FORMAL_CONTRACT_VERSION,
  METRIC_BANDS,
} from './contracts.mjs';
import {
  assertLaneMayMutate,
  BAZI_FOUNDATION_LANE_ID,
} from '../systems/boundary.mjs';
import {
  assertRecord,
  captureExactDataRecord,
  requiredString,
  stringArray,
} from '../shared/assert.mjs';
import { compareCanonical, contentHashV1 } from '../shared/canonical.mjs';

export const CANONICAL_RESOLVER_ID = 'canonical_resolver';
export const CANONICAL_RESOLVER_VERSION = 'canonical_resolver_v3';

function assertCanonicalEffect(effect) {
  return buildEffect(assertRecord(effect, 'Effect'));
}

function assertCanonicalState(state) {
  const canonical = buildFormalState(assertRecord(state, 'FormalState'));
  if (contentHashV1(canonical) !== contentHashV1(state)) {
    throw new TypeError('FormalState and metric keys must match their canonical identities');
  }
  if (canonical.branchKey.system !== 'bazi'
    || canonical.branchKey.laneId !== BAZI_FOUNDATION_LANE_ID) {
    throw new Error('canonical resolver accepts only the closed Bazi foundation lane');
  }
  return canonical;
}

function assertCanonicalEffectOpSet(value) {
  const canonical = buildCanonicalEffectOpSet(assertRecord(value, 'CanonicalEffectOpSet'));
  if (contentHashV1(canonical) !== contentHashV1(value)) {
    throw new TypeError('CanonicalEffectOpSet must match its canonical identity');
  }
  return canonical;
}

const clamp = (index) => Math.max(0, Math.min(METRIC_BANDS.length - 1, index));

export function resolveEffects(priorState, effectOpSet, options = {}) {
  const settings = captureExactDataRecord(
    options,
    [
      'transitionId', 'previousStateHash', 'appliedInteractionRefs',
      'branchKey', 'resolverVersion',
    ],
    'resolveEffects.options',
  );
  if (!priorState || priorState.version !== FORMAL_CONTRACT_VERSION) throw new TypeError('FormalState required');
  const state = assertCanonicalState(priorState);
  const requestedBranch = buildBranchKey(settings.branchKey);
  if (requestedBranch.branchHash !== state.branchKey.branchHash) {
    throw new TypeError('resolver branchKey does not match FormalState branchKey');
  }
  if (settings.resolverVersion !== CANONICAL_RESOLVER_VERSION) {
    throw new TypeError(`resolverVersion must be ${CANONICAL_RESOLVER_VERSION}`);
  }
  const canonicalEffectOpSet = assertCanonicalEffectOpSet(effectOpSet);
  if (canonicalEffectOpSet.branchKey.branchHash !== requestedBranch.branchHash) {
    throw new TypeError('CanonicalEffectOpSet branchKey does not match resolver branchKey');
  }
  const id = requiredString(settings.transitionId, 'transitionId');
  const expectedPreviousStateHash = requiredString(
    settings.previousStateHash,
    'resolveEffects.options.previousStateHash',
  );
  if (expectedPreviousStateHash !== state.stateHash) {
    throw new TypeError('previousStateHash does not match the supplied FormalState');
  }
  const alreadyApplied = new Set(stringArray(
    settings.appliedInteractionRefs,
    'resolveEffects.options.appliedInteractionRefs',
  ));
  const effects = canonicalEffectOpSet.effects;

  const metricsByKey = new Map(state.metrics.map((metric) => [metric.key.keyHash, metric]));
  const effectSemanticHashes = [];
  const groups = new Map();
  const preBlocked = [];
  const interactionRefs = new Set();
  for (const candidate of effects) {
    const effect = assertCanonicalEffect(candidate);
    effectSemanticHashes.push(contentHashV1(effect));
    if (effect.runRef !== state.runRef) {
      throw new TypeError('effect scope does not match state scope');
    }
    for (const interactionRef of effect.causes) {
      if (alreadyApplied.has(interactionRef)) {
        throw new TypeError(`interaction already applied to this state: ${interactionRef}`);
      }
    }
    assertLaneMayMutate(effect.branchKey.laneId, effect.targetKey.metricId);
    if (!metricsByKey.has(effect.targetKey.keyHash)) {
      throw new RangeError(`target metric instance is undeclared: ${effect.targetKey.keyHash}`);
    }
    if (effect.activation?.status !== 'active') {
      preBlocked.push({
        effectId: effect.effectId,
        keyHash: effect.targetKey.keyHash,
        reason: effect.activation?.status === 'inactive' ? 'inactive_effect' : 'unknown_activation',
      });
      continue;
    }
    if (effect.activation.degreePpm !== 1_000_000) {
      preBlocked.push({
        effectId: effect.effectId,
        keyHash: effect.targetKey.keyHash,
        reason: 'partial_activation_not_admitted_v1',
      });
      continue;
    }
    const list = groups.get(effect.targetKey.keyHash) ?? [];
    list.push(effect);
    groups.set(effect.targetKey.keyHash, list);
  }

  const nextByKey = new Map(state.metrics.map((metric) => [metric.key.keyHash, metric]));
  const changes = [];
  const unchanged = [];
  const beforeValues = [];
  const afterValues = [];
  const operationRefs = [];
  const blocked = [...preBlocked];
  for (const keyHash of [...groups.keys()].sort(compareCanonical)) {
    const group = groups.get(keyHash)
      .sort((left, right) => compareCanonical(left.effectId, right.effectId));
    const priorMetric = metricsByKey.get(keyHash);
    const contributorIds = Object.freeze(group.map((effect) => effect.effectId));
    let resultingValue;
    let clamped = false;
    const hasSetUnknown = group.some((effect) => effect.operation === 'set_unknown');
    const hasOtherOperation = group.some((effect) => effect.operation !== 'set_unknown');
    if (hasSetUnknown && hasOtherOperation) {
      blocked.push({ keyHash, reason: 'mixed_set_unknown_operation', contributorIds });
      continue;
    }
    if (hasSetUnknown) {
      resultingValue = buildMetricValue({ value: null, valueStatus: 'unknown' });
    } else if (priorMetric.value.valueStatus === 'unknown') {
      blocked.push({ keyHash, reason: 'unknown_baseline', contributorIds });
      continue;
    } else {
      let netSteps = 0;
      for (const effect of group) {
        const amount = EFFECT_MAGNITUDE_STEPS[effect.magnitude];
        if (effect.operation === 'increase') netSteps += amount;
        if (effect.operation === 'decrease') netSteps -= amount;
      }
      const previousIndex = METRIC_BANDS.indexOf(priorMetric.value.value);
      const requestedIndex = previousIndex + netSteps;
      const clampedIndex = clamp(requestedIndex);
      clamped = clampedIndex !== requestedIndex;
      resultingValue = buildMetricValue({
        value: METRIC_BANDS[clampedIndex],
        valueStatus: 'known',
      });
    }
    operationRefs.push(...contributorIds);
    // Only consumed operations enter the replay ledger. Blocked proposals
    // remain in blocked; net-zero and clamped operations are still consumed.
    for (const effect of group) {
      for (const interactionRef of effect.causes) interactionRefs.add(interactionRef);
    }
    beforeValues.push({ keyHash, value: priorMetric.value });
    afterValues.push({ keyHash, value: resultingValue });
    if (contentHashV1(resultingValue) === contentHashV1(priorMetric.value)) {
      // A group that cancels out or is fully absorbed by a band boundary still
      // consumed admitted effects; it stays in the trace instead of vanishing.
      unchanged.push({
        keyHash,
        value: priorMetric.value,
        contributorIds,
        reason: clamped ? 'clamped_no_change' : 'net_zero_operation',
      });
      continue;
    }
    nextByKey.set(keyHash, Object.freeze({ key: priorMetric.key, value: resultingValue }));
    changes.push({
      targetKey: priorMetric.key,
      previousValue: priorMetric.value,
      resultingValue,
      contributorIds,
      clamped,
    });
  }

  const transitionContentHash = contentHashV1({
    previousStateHash: state.stateHash,
    transitionId: id,
    effectSemanticHashes: effectSemanticHashes.sort(compareCanonical),
  });
  const nextState = buildFormalState({
    stateId: `state:${transitionContentHash}`,
    branchKey: state.branchKey,
    runRef: state.runRef,
    snapshotRef: state.snapshotRef,
    metrics: [...nextByKey.values()],
  });
  const stateDelta = buildStateDelta({
    transitionId: id,
    branchKey: state.branchKey,
    resolverId: CANONICAL_RESOLVER_ID,
    resolverVersion: CANONICAL_RESOLVER_VERSION,
    previousStateRef: state.stateId,
    previousStateHash: state.stateHash,
    nextStateRef: nextState.stateId,
    nextStateHash: nextState.stateHash,
    operationRefs: [...operationRefs].sort(compareCanonical),
    interactionRefs: [...interactionRefs].sort(compareCanonical),
    beforeValues,
    afterValues,
    changes,
    unchanged,
    blocked: [...blocked]
      .map((row) => ({ row, order: contentHashV1(row) }))
      .sort((left, right) => compareCanonical(left.order, right.order))
      .map((entry) => entry.row),
  });
  const authority = 'candidate';
  const admissionStatus = 'candidate';
  return Object.freeze({
    resolverId: CANONICAL_RESOLVER_ID,
    resolver: CANONICAL_RESOLVER_VERSION,
    authority,
    admissionStatus,
    nextState,
    stateDelta,
    semanticHash: contentHashV1({ authority, admissionStatus, nextState, stateDelta }),
  });
}
