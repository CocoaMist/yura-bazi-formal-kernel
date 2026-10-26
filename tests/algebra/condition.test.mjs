import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDITION_VERDICTS,
  EVALUATION_BRANCHES,
  conditionAll,
  conditionAny,
  conditionNot,
  evaluationBranchOf,
  evidenceStatus,
} from '../../src/index.mjs';

test('three-valued condition algebra preserves indeterminate', () => {
  assert.deepEqual(CONDITION_VERDICTS, ['satisfied', 'refuted', 'indeterminate']);
  assert.equal(conditionAll(['satisfied', 'satisfied']), 'satisfied');
  assert.equal(conditionAll(['satisfied', 'indeterminate']), 'indeterminate');
  assert.equal(conditionAll(['satisfied', 'refuted', 'indeterminate']), 'refuted');
  assert.equal(conditionAny(['refuted', 'refuted']), 'refuted');
  assert.equal(conditionAny(['refuted', 'indeterminate']), 'indeterminate');
  assert.equal(conditionAny(['indeterminate', 'satisfied']), 'satisfied');
  assert.equal(conditionNot('satisfied'), 'refuted');
  assert.equal(conditionNot('refuted'), 'satisfied');
  assert.equal(conditionNot('indeterminate'), 'indeterminate');
  assert.equal(conditionAll([]), 'indeterminate');
  assert.equal(conditionAny([]), 'indeterminate');
  assert.equal(conditionAll('satisfied'), 'indeterminate');
  assert.equal(conditionAny('satisfied'), 'indeterminate');
});

test('a refuted condition is not a conflict and every verdict keeps a branch', () => {
  // "conflicted" belongs to disagreement between witnesses or evidence, never
  // to one condition failing to hold.
  assert.equal(CONDITION_VERDICTS.includes('conflicted'), false);
  assert.equal(evaluationBranchOf('satisfied'), 'judgment_candidate');
  assert.equal(evaluationBranchOf('indeterminate'), 'deferred_candidate');
  assert.equal(evaluationBranchOf('refuted'), 'rejected_evaluation');
  assert.deepEqual(Object.keys(EVALUATION_BRANCHES).sort(), [...CONDITION_VERDICTS].sort());
  assert.throws(() => evaluationBranchOf('unknown'), /must be one of/);
});

test('four evidence states retain conflict instead of averaging', () => {
  assert.equal(evidenceStatus(), 'unresolved');
  assert.equal(evidenceStatus({ supporting: true }), 'supported');
  assert.equal(evidenceStatus({ opposing: true }), 'opposed');
  assert.equal(evidenceStatus({ supporting: true, opposing: true }), 'conflicted');
  assert.throws(
    () => evidenceStatus({ supporting: 1, opposing: false }),
    /supporting and opposing must be boolean/,
  );
});
