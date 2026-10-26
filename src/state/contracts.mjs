import { CONDITION_VERDICTS } from '../algebra/condition.mjs';
import { compareCanonical, contentHashV1 } from '../shared/canonical.mjs';
import {
  captureExactDataRecord,
  captureJsonData,
  deepFreeze,
  enumValue,
  optionalString,
  requiredString,
  stringArray,
} from '../shared/assert.mjs';
import { namespaceOf } from '../systems/boundary.mjs';

export const FORMAL_CONTRACT_VERSION = 'formal.state_contract.v2';
export const BRANCH_KEY_VERSION = 'formal.branch_key.v1';
export const STATE_DELTA_VERSION = 'formal.state_delta.v3';
export const FORMAL_STATE_SET_VERSION = 'formal.state_set.v1';
export const CANONICAL_EFFECT_OP_SET_VERSION = 'formal.canonical_effect_op_set.v1';
export const METRIC_BANDS = Object.freeze(['baseline', 'low', 'moderate', 'elevated', 'high']);
export const METRIC_VALUE_STATUSES = Object.freeze(['known', 'unknown']);
export const EFFECT_MAGNITUDES = Object.freeze(['low', 'moderate', 'elevated', 'high']);
// Ordinal band arithmetic is an explicit v0.3 simulation convention, not a
// measured interval scale. It lives beside the bands so the two cannot drift.
export const EFFECT_MAGNITUDE_STEPS = Object.freeze({
  low: 1, moderate: 2, elevated: 3, high: 4,
});
export const EFFECT_OPERATIONS = Object.freeze(['increase', 'decrease', 'set_unknown']);
export const CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high', 'conflicted']);
export const ACTIVATION_STATUSES = Object.freeze(['active', 'inactive', 'unknown']);
export const ACTIVATION_SCALE_PPM = 1_000_000;

// A BranchKey names one school/method/evidence/resolver reading of the same
// chart. Candidates, interactions, effects, deltas and states carry it so two
// readings can never be folded into a single blended conclusion.
export function buildBranchKey(input = {}) {
  const source = captureExactDataRecord(input, [
    'version',
    'system',
    'laneId',
    'ruleProfileId',
    'methodId',
    'evidencePolicyId',
    'resolverPolicyId',
    'branchHash',
  ], 'BranchKey');
  if (source.version != null && source.version !== BRANCH_KEY_VERSION) {
    throw new TypeError(`BranchKey.version must be ${BRANCH_KEY_VERSION}`);
  }
  const body = Object.freeze({
    version: BRANCH_KEY_VERSION,
    system: requiredString(source.system, 'BranchKey.system'),
    laneId: requiredString(source.laneId, 'BranchKey.laneId'),
    ruleProfileId: requiredString(source.ruleProfileId, 'BranchKey.ruleProfileId'),
    methodId: requiredString(source.methodId, 'BranchKey.methodId'),
    evidencePolicyId: requiredString(source.evidencePolicyId, 'BranchKey.evidencePolicyId'),
    resolverPolicyId: requiredString(source.resolverPolicyId, 'BranchKey.resolverPolicyId'),
  });
  const branchHash = contentHashV1(body);
  if (source.branchHash != null && source.branchHash !== branchHash) {
    throw new TypeError('BranchKey.branchHash does not match branch content');
  }
  return Object.freeze({ ...body, branchHash });
}

function sameBranch(left, right) {
  return left.branchHash === right.branchHash;
}

export function buildActivation({ status, degreePpm } = {}) {
  const normalizedStatus = enumValue(status, ACTIVATION_STATUSES, 'Activation.status');
  if (normalizedStatus === 'unknown') {
    if (degreePpm !== null) throw new TypeError('unknown Activation requires degreePpm=null');
  } else if (normalizedStatus === 'inactive') {
    if (degreePpm !== 0) throw new TypeError('inactive Activation requires degreePpm=0');
  } else if (!Number.isInteger(degreePpm) || degreePpm <= 0 || degreePpm > ACTIVATION_SCALE_PPM) {
    throw new TypeError('active Activation requires integer degreePpm in [1, 1000000]');
  }
  return Object.freeze({ status: normalizedStatus, degreePpm });
}

export function buildMetricInstanceKey(input = {}) {
  const {
    metricId,
    branchKey,
    runRef,
    subjectRef,
    validTimeRef,
    contextRef = null,
  } = captureExactDataRecord(input, [
    'version',
    'metricId',
    'branchKey',
    'runRef',
    'subjectRef',
    'validTimeRef',
    'contextRef',
    'keyHash',
  ], 'MetricInstanceKey');
  const normalizedBranch = buildBranchKey(branchKey);
  const normalizedMetric = requiredString(metricId, 'MetricInstanceKey.metricId');
  if (namespaceOf(normalizedMetric) !== normalizedBranch.system) {
    throw new TypeError('MetricInstanceKey.metricId is outside system namespace');
  }
  const key = Object.freeze({
    version: 'formal.metric_instance_key.v1',
    metricId: normalizedMetric,
    branchKey: normalizedBranch,
    runRef: requiredString(runRef, 'MetricInstanceKey.runRef'),
    subjectRef: requiredString(subjectRef, 'MetricInstanceKey.subjectRef'),
    validTimeRef: requiredString(validTimeRef, 'MetricInstanceKey.validTimeRef'),
    contextRef: optionalString(contextRef, 'MetricInstanceKey.contextRef'),
  });
  return Object.freeze({ ...key, keyHash: contentHashV1(key) });
}

export function buildMetricValue({ value = null, valueStatus } = {}) {
  const status = enumValue(valueStatus, METRIC_VALUE_STATUSES, 'MetricValue.valueStatus');
  if (status === 'unknown' && value !== null) throw new TypeError('unknown MetricValue requires value=null');
  if (status === 'known') enumValue(value, METRIC_BANDS, 'MetricValue.value');
  return Object.freeze({ value: status === 'unknown' ? null : value, valueStatus: status });
}

export function buildFormalState({
  stateId, branchKey, runRef, snapshotRef = null, metrics = [],
} = {}) {
  if (!Array.isArray(metrics)) throw new TypeError('FormalState.metrics must be an array');
  const normalizedBranch = buildBranchKey(branchKey);
  const normalizedRun = requiredString(runRef, 'FormalState.runRef');
  const seen = new Set();
  const normalizedMetrics = metrics.map((metric, index) => {
    if (!metric?.key || !metric?.value) throw new TypeError(`FormalState.metrics[${index}] requires key and value`);
    const key = buildMetricInstanceKey(metric.key);
    const value = buildMetricValue(metric.value);
    if (!sameBranch(key.branchKey, normalizedBranch) || key.runRef !== normalizedRun) {
      throw new TypeError('metric instance scope does not match FormalState scope');
    }
    if (seen.has(key.keyHash)) throw new TypeError(`duplicate metric instance: ${key.keyHash}`);
    seen.add(key.keyHash);
    return Object.freeze({ key, value });
  }).sort((left, right) => compareCanonical(left.key.keyHash, right.key.keyHash));
  const body = Object.freeze({
    version: FORMAL_CONTRACT_VERSION,
    authority: 'candidate',
    admissionStatus: 'candidate',
    stateId: requiredString(stateId, 'FormalState.stateId'),
    branchKey: normalizedBranch,
    runRef: normalizedRun,
    snapshotRef: optionalString(snapshotRef, 'FormalState.snapshotRef'),
    metrics: Object.freeze(normalizedMetrics),
  });
  return Object.freeze({ ...body, stateHash: contentHashV1(body) });
}

// Branch results stay a set. There is deliberately no reducer that blends two
// school readings of the same chart into one FormalState.
export function buildFormalStateSet({ setId, states = [] } = {}) {
  if (!Array.isArray(states)) throw new TypeError('FormalStateSet.states must be an array');
  const seen = new Set();
  const normalized = states.map((state) => {
    const rebuilt = buildFormalState(state);
    if (seen.has(rebuilt.branchKey.branchHash)) {
      throw new TypeError(`duplicate branch in FormalStateSet: ${rebuilt.branchKey.branchHash}`);
    }
    seen.add(rebuilt.branchKey.branchHash);
    return rebuilt;
  }).sort((left, right) => compareCanonical(
    left.branchKey.branchHash,
    right.branchKey.branchHash,
  ));
  return Object.freeze({
    version: FORMAL_STATE_SET_VERSION,
    authority: 'candidate',
    admissionStatus: 'candidate',
    setId: requiredString(setId, 'FormalStateSet.setId'),
    branchHashes: Object.freeze(normalized.map((state) => state.branchKey.branchHash)),
    states: Object.freeze(normalized),
  });
}

export function buildFact({
  factId, branchKey, runRef, subjectRef, predicate, value,
  validTimeRef, evidenceRefs = [], provenanceRef = null, factGraphRef = null,
} = {}) {
  if (value === undefined) throw new TypeError('Fact.value is required');
  const normalizedBranch = buildBranchKey(branchKey);
  const normalizedPredicate = requiredString(predicate, 'Fact.predicate');
  if (namespaceOf(normalizedPredicate) !== normalizedBranch.system) {
    throw new TypeError('Fact.predicate is outside system namespace');
  }
  return Object.freeze({
    version: FORMAL_CONTRACT_VERSION,
    factId: requiredString(factId, 'Fact.factId'),
    branchKey: normalizedBranch,
    runRef: requiredString(runRef, 'Fact.runRef'),
    subjectRef: requiredString(subjectRef, 'Fact.subjectRef'),
    predicate: normalizedPredicate,
    value: deepFreeze(captureJsonData(value, 'Fact.value')),
    validTimeRef: requiredString(validTimeRef, 'Fact.validTimeRef'),
    evidenceRefs: stringArray(evidenceRefs, 'Fact.evidenceRefs'),
    provenanceRef: optionalString(provenanceRef, 'Fact.provenanceRef'),
    factGraphRef: optionalString(factGraphRef, 'Fact.factGraphRef'),
  });
}

export function buildInteraction({
  interactionId, branchKey, runRef, kind, participantRefs,
  derivedFrom, verdict, validTimeRef, witnessRef = null,
} = {}) {
  const participants = stringArray(participantRefs, 'Interaction.participantRefs');
  const causes = stringArray(derivedFrom, 'Interaction.derivedFrom');
  if (!participants.length || !causes.length) throw new TypeError('Interaction requires participants and derivedFrom');
  const normalizedBranch = buildBranchKey(branchKey);
  const normalizedKind = requiredString(kind, 'Interaction.kind');
  if (namespaceOf(normalizedKind) !== normalizedBranch.system) {
    throw new TypeError('Interaction.kind is outside system namespace');
  }
  return Object.freeze({
    version: FORMAL_CONTRACT_VERSION,
    interactionId: requiredString(interactionId, 'Interaction.interactionId'),
    branchKey: normalizedBranch,
    runRef: requiredString(runRef, 'Interaction.runRef'),
    kind: normalizedKind,
    participantRefs: participants,
    derivedFrom: causes,
    verdict: enumValue(verdict, CONDITION_VERDICTS, 'Interaction.verdict'),
    validTimeRef: requiredString(validTimeRef, 'Interaction.validTimeRef'),
    witnessRef: optionalString(witnessRef, 'Interaction.witnessRef'),
  });
}

export function buildEffect({
  effectId, branchKey, runRef, targetKey, activation, operation, magnitude,
  confidence, causes, contributionRef = null, effectTemplateRef = null,
} = {}) {
  const normalizedBranch = buildBranchKey(branchKey);
  const normalizedRun = requiredString(runRef, 'Effect.runRef');
  const key = buildMetricInstanceKey(targetKey);
  if (!sameBranch(key.branchKey, normalizedBranch) || key.runRef !== normalizedRun) {
    throw new TypeError('Effect target scope does not match Effect scope');
  }
  const causeRefs = stringArray(causes, 'Effect.causes');
  if (!causeRefs.length) throw new TypeError('Effect.causes requires at least one reference');
  if (causeRefs.some((reference) => !reference.startsWith('interaction:'))) {
    throw new TypeError('Effect.causes must reference Interaction identifiers');
  }
  return Object.freeze({
    version: FORMAL_CONTRACT_VERSION,
    authority: 'candidate',
    admissionStatus: 'candidate',
    effectId: requiredString(effectId, 'Effect.effectId'),
    branchKey: normalizedBranch,
    runRef: normalizedRun,
    targetKey: key,
    activation: buildActivation(activation),
    operation: enumValue(operation, EFFECT_OPERATIONS, 'Effect.operation'),
    magnitude: enumValue(magnitude, EFFECT_MAGNITUDES, 'Effect.magnitude'),
    confidence: enumValue(confidence, CONFIDENCE_LEVELS, 'Effect.confidence'),
    causes: causeRefs,
    contributionRef: optionalString(contributionRef, 'Effect.contributionRef'),
    effectTemplateRef: optionalString(effectTemplateRef, 'Effect.effectTemplateRef'),
  });
}

export function buildCanonicalEffectOpSet(input = {}) {
  const source = captureExactDataRecord(input, [
    'version', 'branchKey', 'effects', 'effectOpSetHash',
  ], 'CanonicalEffectOpSet');
  if (source.version != null && source.version !== CANONICAL_EFFECT_OP_SET_VERSION) {
    throw new TypeError(`CanonicalEffectOpSet.version must be ${CANONICAL_EFFECT_OP_SET_VERSION}`);
  }
  if (!Array.isArray(source.effects)) throw new TypeError('CanonicalEffectOpSet.effects must be an array');
  const branchKey = buildBranchKey(source.branchKey);
  const effectIds = new Set();
  const effects = source.effects.map((effect) => {
    const normalized = buildEffect(effect);
    if (contentHashV1(normalized) !== contentHashV1(effect)) {
      throw new TypeError('Effect and targetKey must match their canonical identities');
    }
    if (!sameBranch(normalized.branchKey, branchKey)) {
      throw new TypeError('CanonicalEffectOpSet effect branch does not match set branch');
    }
    if (effectIds.has(normalized.effectId)) {
      throw new TypeError(`duplicate effectId: ${normalized.effectId}`);
    }
    effectIds.add(normalized.effectId);
    return normalized;
  }).sort((left, right) => compareCanonical(left.effectId, right.effectId));
  const body = Object.freeze({
    version: CANONICAL_EFFECT_OP_SET_VERSION,
    branchKey,
    effects: Object.freeze(effects),
  });
  const effectOpSetHash = contentHashV1(body);
  if (source.effectOpSetHash != null && source.effectOpSetHash !== effectOpSetHash) {
    throw new TypeError('CanonicalEffectOpSet.effectOpSetHash does not match set content');
  }
  return Object.freeze({ ...body, effectOpSetHash });
}

// A StateDelta must be replayable on its own: it binds the branch, the exact
// prior and next state hashes, the operations applied and every rejected or
// no-op contributor, so no path through the resolver is unrecorded.
export function buildStateDelta({
  transitionId, branchKey, resolverId, resolverVersion,
  previousStateRef, previousStateHash, nextStateRef, nextStateHash,
  operationRefs = [], interactionRefs = [],
  beforeValues = [], afterValues = [],
  changes, unchanged = [], blocked = [],
} = {}) {
  if (!Array.isArray(changes)) throw new TypeError('StateDelta.changes must be an array');
  if (!Array.isArray(unchanged)) throw new TypeError('StateDelta.unchanged must be an array');
  if (!Array.isArray(blocked)) throw new TypeError('StateDelta.blocked must be an array');
  const normalizedBranch = buildBranchKey(branchKey);
  const body = Object.freeze({
    version: STATE_DELTA_VERSION,
    authority: 'candidate',
    admissionStatus: 'candidate',
    resolverId: requiredString(resolverId, 'StateDelta.resolverId'),
    resolverVersion: requiredString(resolverVersion, 'StateDelta.resolverVersion'),
    transitionId: requiredString(transitionId, 'StateDelta.transitionId'),
    branchKey: normalizedBranch,
    previousStateRef: requiredString(previousStateRef, 'StateDelta.previousStateRef'),
    previousStateHash: requiredString(previousStateHash, 'StateDelta.previousStateHash'),
    nextStateRef: requiredString(nextStateRef, 'StateDelta.nextStateRef'),
    nextStateHash: requiredString(nextStateHash, 'StateDelta.nextStateHash'),
    operationRefs: stringArray(operationRefs, 'StateDelta.operationRefs'),
    interactionRefs: stringArray(interactionRefs, 'StateDelta.interactionRefs'),
    beforeValues: Object.freeze(beforeValues.map((row) => Object.freeze({ ...row }))),
    afterValues: Object.freeze(afterValues.map((row) => Object.freeze({ ...row }))),
    changes: Object.freeze(changes.map((change) => Object.freeze({ ...change }))),
    unchanged: Object.freeze(unchanged.map((row) => Object.freeze({ ...row }))),
    blocked: Object.freeze(blocked.map((row) => Object.freeze({ ...row }))),
  });
  return Object.freeze({ ...body, provenanceRoot: contentHashV1(body) });
}
