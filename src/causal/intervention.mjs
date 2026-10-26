import {
  captureExactDataRecord,
  enumValue,
  optionalString,
  requiredString,
  stringArray,
} from '../shared/assert.mjs';
import { CONTRIBUTION_BANDS } from './contribution.mjs';

export const AWARENESS_STATES = Object.freeze([
  'unknown', 'unaware', 'aware', 'acknowledged', 'planned', 'acted', 'verified',
]);

export const OBSERVED_OUTCOMES = Object.freeze([
  'not_observed',
  'occurred',
  'delayed',
  'did_not_occur_after_intervention',
  'occurred_despite_intervention',
  'indeterminate',
]);

export function advanceAwareness(current, next) {
  const from = enumValue(current, AWARENESS_STATES, 'current awareness');
  const to = enumValue(next, AWARENESS_STATES, 'next awareness');
  if (AWARENESS_STATES.indexOf(to) < AWARENESS_STATES.indexOf(from)) {
    throw new RangeError('awareness state may not move backwards');
  }
  return to;
}

export function buildInterventionBranch(input = {}) {
  const value = captureExactDataRecord(input, [
    'branchId',
    'system',
    'laneId',
    'runRef',
    'subjectRef',
    'validTimeRef',
    'hypothesisRef',
    'awarenessState',
    'actionRef',
    'controllabilityBand',
    'feasibilityBand',
    'costBand',
    'expectedResponseBand',
    'observedOutcome',
    'evidenceRefs',
    'calibrationRef',
  ], 'InterventionBranch');
  const awarenessState = enumValue(
    value.awarenessState,
    AWARENESS_STATES,
    'InterventionBranch.awarenessState',
  );
  const actionRef = optionalString(value.actionRef, 'InterventionBranch.actionRef');
  const observedOutcome = value.observedOutcome == null
    ? null
    : enumValue(value.observedOutcome, OBSERVED_OUTCOMES, 'InterventionBranch.observedOutcome');
  const actionTaken = awarenessState === 'acted' || awarenessState === 'verified';
  if (actionTaken && actionRef === null) {
    throw new TypeError('acted or verified intervention requires actionRef');
  }
  if (!actionTaken && observedOutcome != null && observedOutcome !== 'not_observed') {
    throw new TypeError('observed intervention outcome requires acted or verified awareness');
  }
  return Object.freeze({
    version: 'formal.intervention_branch.v1',
    branchId: requiredString(value.branchId, 'InterventionBranch.branchId'),
    system: requiredString(value.system, 'InterventionBranch.system'),
    laneId: requiredString(value.laneId, 'InterventionBranch.laneId'),
    runRef: requiredString(value.runRef, 'InterventionBranch.runRef'),
    subjectRef: requiredString(value.subjectRef, 'InterventionBranch.subjectRef'),
    validTimeRef: requiredString(value.validTimeRef, 'InterventionBranch.validTimeRef'),
    hypothesisRef: requiredString(value.hypothesisRef, 'InterventionBranch.hypothesisRef'),
    awarenessState,
    actionRef,
    controllabilityBand: enumValue(value.controllabilityBand, CONTRIBUTION_BANDS, 'InterventionBranch.controllabilityBand'),
    feasibilityBand: enumValue(value.feasibilityBand, CONTRIBUTION_BANDS, 'InterventionBranch.feasibilityBand'),
    costBand: enumValue(value.costBand, CONTRIBUTION_BANDS, 'InterventionBranch.costBand'),
    expectedResponseBand: enumValue(value.expectedResponseBand, CONTRIBUTION_BANDS, 'InterventionBranch.expectedResponseBand'),
    observedOutcome,
    evidenceRefs: stringArray(value.evidenceRefs, 'InterventionBranch.evidenceRefs'),
    calibrationRef: optionalString(value.calibrationRef, 'InterventionBranch.calibrationRef'),
    hypothetical: !actionTaken,
    causalClaim: false,
    natalStateMutation: false,
    historicalFactMutation: false,
  });
}
