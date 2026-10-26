import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRecord,
  captureJsonData,
  captureExactDataRecord,
  deepFreeze,
  finiteNumber,
  optionalString,
  requiredString,
  stringArray,
} from '../../src/shared/assert.mjs';
import { canonicalJsonV1, contentHashV1, compareCanonical } from '../../src/shared/canonical.mjs';
import {
  assertLaneMayMutate,
  namespaceOf,
} from '../../src/systems/boundary.mjs';

test('shared validators cover every primitive failure class', () => {
  assert.deepEqual(assertRecord({}, 'record'), {});
  for (const value of [null, [], 'record']) {
    assert.throws(() => assertRecord(value, 'record'), /must be an object/);
  }

  assert.deepEqual(captureExactDataRecord({ present: 1 }, ['present', 'missing'], 'dto'), {
    present: 1,
  });
  const symbolField = Symbol('extra');
  assert.throws(
    () => captureExactDataRecord({ present: 1, [symbolField]: 2 }, ['present'], 'dto'),
    /unknown fields/,
  );
  assert.deepEqual(
    captureExactDataRecord(Object.assign(Object.create(null), { present: 1 }), ['present'], 'dto'),
    { present: 1 },
  );
  class Dto { constructor() { this.present = 1; } }
  assert.throws(
    () => captureExactDataRecord(new Dto(), ['present'], 'dto'),
    /must be a plain object or a null-prototype record/,
  );
  assert.throws(
    () => captureExactDataRecord(Object.create({ present: 1 }), ['present'], 'dto'),
    /must be a plain object or a null-prototype record/,
  );

  assert.equal(requiredString('value', 'field'), 'value');
  assert.throws(() => requiredString(1, 'field'), /non-empty string/);
  assert.throws(() => requiredString('   ', 'field'), /non-empty string/);
  assert.equal(optionalString(null, 'field'), null);
  assert.equal(optionalString('value', 'field'), 'value');

  assert.deepEqual(stringArray(null, 'items'), []);
  assert.throws(() => stringArray({}, 'items'), /must be an array/);
  assert.throws(() => stringArray([''], 'items'), /non-empty string/);

  assert.equal(finiteNumber(1, 'number'), 1);
  assert.equal(finiteNumber(0, 'number', { min: -1, max: 1 }), 0);
  assert.throws(() => finiteNumber('1', 'number'), /finite number/);
  assert.throws(() => finiteNumber(Number.NaN, 'number'), /finite number/);
  assert.throws(() => finiteNumber(-2, 'number', { min: -1, max: 1 }), /finite number/);
  assert.throws(() => finiteNumber(2, 'number', { min: -1, max: 1 }), /finite number/);

  assert.equal(deepFreeze(null), null);
  assert.equal(deepFreeze(1), 1);
  const alreadyFrozen = Object.freeze({ value: 1 });
  assert.equal(deepFreeze(alreadyFrozen), alreadyFrozen);
  assert.equal(captureJsonData(true), true);
  assert.equal(captureJsonData('e\u0301'), '\u00e9');
  assert.equal(captureJsonData(-0), 0);
  assert.throws(() => captureJsonData(Number.POSITIVE_INFINITY), /finite JSON/);
  assert.throws(() => captureJsonData(undefined), /JSON data/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => captureJsonData(sparse), /own data property/);
  class ArrayVariant extends Array {}
  assert.throws(() => captureJsonData(new ArrayVariant()), /plain array/);
  assert.throws(() => captureJsonData(new Date()), /plain JSON object/);
  assert.throws(() => captureJsonData({ [Symbol('x')]: 1 }), /string keys/);
  const jsonGetter = {};
  Object.defineProperty(jsonGetter, 'value', { get() { return 1; }, enumerable: true });
  assert.throws(() => captureJsonData(jsonGetter), /own data property/);
  const dtoGetter = {};
  Object.defineProperty(dtoGetter, 'present', { get() { return 1; }, enumerable: true });
  assert.throws(() => captureExactDataRecord(dtoGetter, ['present'], 'dto'), /own data property/);
});

test('canonical ordering is by code unit and never by locale collation', () => {
  assert.equal(compareCanonical('a', 'a'), 0);
  assert.equal(compareCanonical('B', 'a'), -1);
  assert.equal(compareCanonical('a', 'B'), 1);
  // localeCompare would answer the opposite for this pair under most locales.
  assert.equal('a'.localeCompare('B') < 0, true);
  assert.deepEqual(['a', 'B', 'A', 'b'].sort(compareCanonical), ['A', 'B', 'a', 'b']);
});

test('namespace and mutation lane guards reject both independent escape routes', () => {
  assert.equal(namespaceOf('bazi.metric'), 'bazi');
  assert.throws(() => namespaceOf('bazi'), /must be namespaced/);
  assert.throws(() => namespaceOf('.metric'), /must be namespaced/);
  assert.equal(assertLaneMayMutate('bazi.foundation.v1', 'bazi.metric'), true);
  assert.throws(
    () => assertLaneMayMutate('other.foundation.v1', 'bazi.metric'),
    /may not mutate namespace/,
  );
  assert.throws(
    () => assertLaneMayMutate('bazi.foundation.v1', 'other.metric'),
    /may not mutate namespace/,
  );
});

test('canonical JSON emits numeric-looking keys in code-unit order at every depth', () => {
assert.equal(canonicalJsonV1({ 2: 'two', 10: 'ten', nested: { 9: true, 11: null } }),
'{"10":"ten","2":"two","nested":{"11":null,"9":true}}');
assert.equal(canonicalJsonV1({ '\uE000': 1, '\u{10000}': 2 }), '{"\u{10000}":2,"\uE000":1}');
assert.equal(canonicalJsonV1([]), '[]');
});

test('canonical capture normalizes keys without collisions or prototype setters', () => {
assert.equal(contentHashV1({ 'e\u0301': { text: 'e\u0301' } }), contentHashV1({ '\u00e9': { text: '\u00e9' } }));
assert.deepEqual(captureJsonData({ 'e\u0301': 1 }), { '\u00e9': 1 });
assert.throws(() => canonicalJsonV1({ 'e\u0301': 1, '\u00e9': 2 }), /duplicate NFC key/);
const captured = captureJsonData(JSON.parse('{"__proto__":{"polluted":true}}'));
assert.equal(Object.getPrototypeOf(captured), Object.prototype);
assert.equal(Object.hasOwn(captured, '__proto__'), true);
assert.equal(captured.polluted, undefined);
assert.equal(canonicalJsonV1(captured), '{"__proto__":{"polluted":true}}');
});

test('public canonical JSON rejects sparse and accessor inputs without invoking getters', () => {
let reads = 0;
const value = Object.defineProperty({}, 'field', { enumerable: true, get() { reads += 1; return 1; } });
assert.throws(() => canonicalJsonV1(value), /own data property/);
assert.throws(() => canonicalJsonV1(Array(1)), /own data property/);
assert.equal(reads, 0);
assert.equal(canonicalJsonV1([null]), '[null]');
});
