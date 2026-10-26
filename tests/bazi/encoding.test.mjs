import test from 'node:test';
import assert from 'node:assert/strict';
import * as publicApi from '../../src/index.mjs';
import {
  BRANCH_IDS,
  CANONICAL_CHART_COORDINATE_VERSION,
  assertPillarGrammar,
  expectedHourStemId,
  expectedMonthStemId,
  GRAMMAR_STATE_COUNT,
  GRAMMAR_STATE_INDEX_VERSION,
  packFourPillars24,
  pillarFromSexagenaryIndex,
  rankGrammarState19,
  sexagenaryIndex,
  STEM_IDS,
  unrankGrammarState19,
  unpackFourPillars24,
} from '../../src/index.mjs';
import { buildValidatedPillarCoordinate } from '../../src/bazi/encoding.mjs';

test('all 60 sexagenary pillars roundtrip and invalid parity is rejected', () => {
  for (let index = 0; index < 60; index += 1) {
    assert.equal(sexagenaryIndex(pillarFromSexagenaryIndex(index)), index);
  }
  let valid = 0;
  let invalid = 0;
  for (const stemId of STEM_IDS) {
    for (const branchId of BRANCH_IDS) {
      try {
        sexagenaryIndex({ stemId, branchId });
        valid += 1;
      } catch {
        invalid += 1;
      }
    }
  }
  assert.equal(valid, 60);
  assert.equal(invalid, 60);
  for (const bad of [-1, 60, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
    assert.throws(() => pillarFromSexagenaryIndex(bad));
  }
});

test('24-bit layout is fixed, reversible and grammar-valid', () => {
  const indices = [0, 2, 59, 48];
  const pillars = Object.fromEntries(['year', 'month', 'day', 'hour'].map((slot, i) => [
    slot,
    pillarFromSexagenaryIndex(indices[i]),
  ]));
  const packed = packFourPillars24(pillars);
  assert.equal(packed, 12_824_704);
  assert.deepEqual(unpackFourPillars24(packed), pillars);

  const invalidGrammar = {
    year: pillarFromSexagenaryIndex(0),
    month: pillarFromSexagenaryIndex(1),
    day: pillarFromSexagenaryIndex(0),
    hour: pillarFromSexagenaryIndex(0),
  };
  assert.throws(() => packFourPillars24(invalidGrammar), /month stem mismatch/);
  assert.throws(() => unpackFourPillars24(1 << 6), /month stem mismatch/);
  for (const shift of [0, 6, 12, 18]) assert.throws(() => unpackFourPillars24(60 << shift));
  for (const bad of [-1, 0x01_00_00_00, 1.5]) assert.throws(() => unpackFourPillars24(bad));
});

test('internal validated coordinate builds all numeric views once and stays out of public API', () => {
  const indices = [0, 2, 59, 48];
  const pillars = Object.fromEntries(['year', 'month', 'day', 'hour'].map((slot, index) => [
    slot,
    pillarFromSexagenaryIndex(indices[index]),
  ]));
  const coordinate = buildValidatedPillarCoordinate(pillars);

  assert.deepEqual(coordinate, {
    version: CANONICAL_CHART_COORDINATE_VERSION,
    coordinateHash: coordinate.coordinateHash,
    pillarCode24: 12_824_704,
    index19: 2_148,
    stemCodes4: [0, 2, 9, 8],
    branchCodes4: [0, 2, 11, 0],
    sexagenaryCodes4: [0, 2, 59, 48],
    visibleStemPresenceMask10: 773,
    branchPresenceMask12: 2_053,
    stemSlotMasks4ByCode10: [1, 0, 2, 0, 0, 0, 0, 0, 8, 4],
    branchSlotMasks4ByCode12: [9, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 4],
  });
  assert.equal(coordinate.pillarCode24, packFourPillars24(pillars));
  assert.equal(coordinate.index19, rankGrammarState19(pillars));
  assert.equal(Object.isFrozen(coordinate), true);
  for (const field of [
    'stemCodes4',
    'branchCodes4',
    'sexagenaryCodes4',
    'stemSlotMasks4ByCode10',
    'branchSlotMasks4ByCode12',
  ]) {
    assert.equal(Array.isArray(coordinate[field]), true, `${field} must be a plain array`);
    assert.equal(Object.isFrozen(coordinate[field]), true, `${field} must be frozen`);
  }
  assert.equal('buildValidatedPillarCoordinate' in publicApi, false);
  assert.equal('captureValidatedPillars' in publicApi, false);
});

test('external pillar boundaries capture own data once and reject accessors or inherited fields', () => {
  const valid = unrankGrammarState19(1_440);
  const accessorYear = {};
  Object.defineProperties(accessorYear, {
    stemId: { enumerable: true, get: () => 'jia' },
    branchId: { enumerable: true, get: () => 'zi' },
  });
  const accessorPillars = { ...valid, year: accessorYear };
  for (const operation of [
    () => sexagenaryIndex(accessorYear),
    () => assertPillarGrammar(accessorPillars),
    () => packFourPillars24(accessorPillars),
    () => rankGrammarState19(accessorPillars),
  ]) assert.throws(operation, /own data property/);

  const inheritedPillars = Object.fromEntries(Object.entries(valid).map(([slot, pillar]) => [
    slot,
    Object.create({ stemId: pillar.stemId, branchId: pillar.branchId }),
  ]));
  for (const operation of [
    () => assertPillarGrammar(inheritedPillars),
    () => packFourPillars24(inheritedPillars),
    () => rankGrammarState19(inheritedPillars),
  ]) assert.throws(operation, /must be a plain object or a null-prototype record/);

  class PillarLike {
    constructor(pillar) {
      this.stemId = pillar.stemId;
      this.branchId = pillar.branchId;
    }
  }
  assert.throws(
    () => sexagenaryIndex(new PillarLike(valid.year)),
    /must be a plain object or a null-prototype record/,
  );
  const nullPrototypePillar = Object.assign(Object.create(null), valid.year);
  assert.equal(sexagenaryIndex(nullPrototypePillar), sexagenaryIndex(valid.year));

  let dynamicReads = 0;
  const proxiedYear = new Proxy(valid.year, {
    get(target, key, receiver) {
      dynamicReads += 1;
      if (key === 'stemId') return 'gui';
      if (key === 'branchId') return 'hai';
      return Reflect.get(target, key, receiver);
    },
  });
  const proxiedPillars = { ...valid, year: proxiedYear };
  assert.equal(packFourPillars24(proxiedPillars), packFourPillars24(valid));
  assert.equal(rankGrammarState19(proxiedPillars), rankGrammarState19(valid));
  assert.equal(dynamicReads, 0);
});

test('month and hour stem grammar covers every stem/branch combination', () => {
  for (const yearStemId of STEM_IDS) {
    for (const monthBranchId of BRANCH_IDS) {
      const monthStemId = expectedMonthStemId(yearStemId, monthBranchId);
      assert.doesNotThrow(() => sexagenaryIndex({ stemId: monthStemId, branchId: monthBranchId }));
    }
  }
  for (const dayStemId of STEM_IDS) {
    for (const hourBranchId of BRANCH_IDS) {
      const hourStemId = expectedHourStemId(dayStemId, hourBranchId);
      assert.doesNotThrow(() => sexagenaryIndex({ stemId: hourStemId, branchId: hourBranchId }));
    }
  }
  assert.equal(expectedMonthStemId('jia', 'yin'), 'bing');
  assert.equal(expectedMonthStemId('gui', 'yin'), 'jia');
  assert.equal(expectedHourStemId('jia', 'zi'), 'jia');
  assert.equal(expectedHourStemId('gui', 'zi'), 'ren');
  assert.throws(() => expectedMonthStemId('unknown', 'yin'), /unknown year stem/);
  assert.throws(() => expectedMonthStemId('jia', 'unknown'), /unknown month branch/);
  assert.throws(() => expectedHourStemId('unknown', 'zi'), /unknown day stem/);
  assert.throws(() => expectedHourStemId('jia', 'unknown'), /unknown hour branch/);

  const invalidHourGrammar = {
    ...unrankGrammarState19(0),
    hour: { stemId: 'bing', branchId: 'zi' },
  };
  assert.throws(() => assertPillarGrammar(invalidHourGrammar), /hour stem mismatch/);
});

test('19-bit grammar-state rank is dense, reversible and code24-compatible at boundaries', () => {
  assert.equal(GRAMMAR_STATE_INDEX_VERSION, 'bazi.grammar_state_index19.v1');
  assert.equal(GRAMMAR_STATE_COUNT, 518_400);
  assert.ok(GRAMMAR_STATE_COUNT <= 2 ** 19);

  const samples = [
    0,
    1,
    11,
    12,
    719,
    720,
    8_639,
    8_640,
    259_199,
    259_200,
    GRAMMAR_STATE_COUNT - 2,
    GRAMMAR_STATE_COUNT - 1,
  ];
  for (const index of samples) {
    const pillars = unrankGrammarState19(index);
    assert.equal(rankGrammarState19(pillars), index);
    const code24 = packFourPillars24(pillars);
    assert.equal(rankGrammarState19(unpackFourPillars24(code24)), index);
    assert.equal(packFourPillars24(unrankGrammarState19(index)), code24);
  }

  assert.deepEqual(unrankGrammarState19(0), {
    year: { stemId: 'jia', branchId: 'zi' },
    month: { stemId: 'bing', branchId: 'zi' },
    day: { stemId: 'jia', branchId: 'zi' },
    hour: { stemId: 'jia', branchId: 'zi' },
  });
  assert.deepEqual(unrankGrammarState19(GRAMMAR_STATE_COUNT - 1), {
    year: { stemId: 'gui', branchId: 'hai' },
    month: { stemId: 'gui', branchId: 'hai' },
    day: { stemId: 'gui', branchId: 'hai' },
    hour: { stemId: 'gui', branchId: 'hai' },
  });
});

test('19-bit grammar-state decoder rejects invalid and reserved-tail indices', () => {
  for (const bad of [
    -1,
    GRAMMAR_STATE_COUNT,
    (2 ** 19) - 1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '0',
  ]) {
    assert.throws(() => unrankGrammarState19(bad), RangeError);
  }

  const invalidGrammar = {
    year: pillarFromSexagenaryIndex(0),
    month: pillarFromSexagenaryIndex(1),
    day: pillarFromSexagenaryIndex(0),
    hour: pillarFromSexagenaryIndex(0),
  };
  assert.throws(() => rankGrammarState19(invalidGrammar), /month stem mismatch/);
});
