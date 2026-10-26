import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCharts } from '../src/comparison.mjs';
import { chart } from './fixtures.mjs';

test('same four pillars remain two distinct subjects', () => {
  const result = compareCharts(chart('subject:a'), chart('subject:b'));
  assert.equal(result.sameChartContent, true);
  assert.equal(result.left.subjectRef, 'subject:a');
  assert.equal(result.right.subjectRef, 'subject:b');
  assert.equal(result.pairs.length, 16);
  assert.equal(result.effectEligible, false);
  assert.equal(result.utility, 'indeterminate');
  assert.ok(result.pairs.every((pair) => pair.relation.effectEligible === false));
});

test('self comparison is rejected and one-subject variants require explicit mode', () => {
  const original = chart('subject:a', 'snapshot:a1');
  assert.throws(() => compareCharts(original, original), /distinct subject-scoped snapshots/);
  assert.throws(
    () => compareCharts(original, chart('subject:a', 'snapshot:a2')),
    /synastry requires distinct subjects/
  );
  const variant = compareCharts(original, chart('subject:a', 'snapshot:a2'), { mode: 'variant' });
  assert.equal(variant.mode, 'variant');
});

test('input accessors are rejected without invocation', () => {
  let invoked = false;
  const unsafe = chart();
  Object.defineProperty(unsafe, 'subjectRef', {
    enumerable: true,
    get() {
      invoked = true;
      return 'subject:unsafe';
    }
  });
  assert.throws(() => compareCharts(unsafe, chart('subject:b')), /must be own data/);
  assert.equal(invoked, false);
});

test('comparison options reject accessors without invocation', () => {
  let invoked = false;
  const options = {};
  Object.defineProperty(options, 'mode', {
    enumerable: true,
    get() {
      invoked = true;
      return 'synastry';
    }
  });
  assert.throws(() => compareCharts(chart('subject:a'), chart('subject:b'), options), /must be own data/);
  assert.equal(invoked, false);
});

test('comparison identity includes time identity and provenance', () => {
  const left = chart('subject:a');
  const first = compareCharts(left, chart('subject:b'));
  const second = compareCharts(left, chart('subject:b', 'snapshot:subject:b', {
    validTimeRef: 'time:subject:b:corrected'
  }));
  assert.notEqual(first.comparisonId, second.comparisonId);
  assert.equal(first.scopeProfileId, 'bazi.comparison_scope.cross_subject_raw.v1');
});
