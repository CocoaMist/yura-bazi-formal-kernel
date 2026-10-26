import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCompleteBranchGroups,
  relateBranchOccurrences,
  relateStemOccurrences
} from '../src/relations.mjs';

function stem(occurrenceId, stemId) {
  return { occurrenceId, scope: 'test', location: occurrenceId, subjectRef: null, stemId };
}

function branch(occurrenceId, branchId) {
  return { occurrenceId, scope: 'test', location: occurrenceId, subjectRef: null, branchId };
}

test('direction and combination remain separate raw codes', () => {
  const generation = relateStemOccurrences(stem('a', 'jia'), stem('b', 'bing'));
  assert.ok(generation.codes.includes('left_generates_right'));
  const combination = relateStemOccurrences(stem('a', 'jia'), stem('b', 'ji'));
  assert.ok(combination.codes.includes('stem_five_combination'));
  assert.equal(combination.transformationEstablished, false);
  assert.equal(combination.effectEligible, false);
});

test('overlapping branch relations are not forced into one winner', () => {
  const result = relateBranchOccurrences(branch('a', 'yin'), branch('b', 'hai'));
  assert.ok(result.codes.includes('six_harmony'));
  assert.ok(result.codes.includes('break'));
});

test('complete groups retain occurrence identity', () => {
  const groups = detectCompleteBranchGroups([
    branch('a', 'shen'),
    branch('b', 'zi'),
    branch('c1', 'chen'),
    branch('c2', 'chen')
  ]).filter((group) => group.code === 'three_harmony');
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.participants[2].occurrenceId), ['c1', 'c2']);
  assert.ok(groups.every((group) => group.complete && !group.transformationEstablished));
});
