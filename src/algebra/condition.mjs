import { enumValue } from '../shared/assert.mjs';

// A single condition is satisfied, refuted or indeterminate. "conflicted" is
// reserved for disagreement *between* witnesses, rules, profiles or evidence
// and is never a verdict about one condition.
export const CONDITION_VERDICTS = Object.freeze(['satisfied', 'refuted', 'indeterminate']);
export const EVIDENCE_STATUSES = Object.freeze(['supported', 'opposed', 'conflicted', 'unresolved']);

// Every verdict class keeps a downstream branch; refuted and indeterminate are
// retained results with their own trace, not discarded evaluations.
export const EVALUATION_BRANCHES = Object.freeze({
  satisfied: 'judgment_candidate',
  indeterminate: 'deferred_candidate',
  refuted: 'rejected_evaluation',
});

export function evaluationBranchOf(verdict) {
  return EVALUATION_BRANCHES[enumValue(verdict, CONDITION_VERDICTS, 'verdict')];
}

export function conditionNot(verdict) {
  enumValue(verdict, CONDITION_VERDICTS, 'verdict');
  if (verdict === 'satisfied') return 'refuted';
  if (verdict === 'refuted') return 'satisfied';
  return 'indeterminate';
}

export function conditionAll(verdicts) {
  if (!Array.isArray(verdicts) || !verdicts.length) return 'indeterminate';
  verdicts.forEach((verdict, index) => enumValue(verdict, CONDITION_VERDICTS, `verdicts[${index}]`));
  if (verdicts.includes('refuted')) return 'refuted';
  if (verdicts.includes('indeterminate')) return 'indeterminate';
  return 'satisfied';
}

export function conditionAny(verdicts) {
  if (!Array.isArray(verdicts) || !verdicts.length) return 'indeterminate';
  verdicts.forEach((verdict, index) => enumValue(verdict, CONDITION_VERDICTS, `verdicts[${index}]`));
  if (verdicts.includes('satisfied')) return 'satisfied';
  if (verdicts.includes('indeterminate')) return 'indeterminate';
  return 'refuted';
}

export function evidenceStatus({ supporting = false, opposing = false } = {}) {
  if (typeof supporting !== 'boolean' || typeof opposing !== 'boolean') {
    throw new TypeError('supporting and opposing must be boolean');
  }
  if (supporting && opposing) return 'conflicted';
  if (supporting) return 'supported';
  if (opposing) return 'opposed';
  return 'unresolved';
}
