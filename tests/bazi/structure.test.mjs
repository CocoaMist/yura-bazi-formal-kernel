import test from 'node:test';
import assert from 'node:assert/strict';
import * as publicApi from '../../src/index.mjs';
import { BRANCH_IDS, STEM_IDS } from '../../src/bazi/constants.mjs';
import { buildValidatedPillarCoordinate } from '../../src/bazi/encoding.mjs';
import {
  BAZI_STRUCTURAL_CODEBOOK,
  BAZI_STRUCTURAL_PROFILE,
  GROWTH_STAGE_PROFILE,
  GROWTH_STAGE_PROFILE_ID,
  HIDDEN_STEM_PROFILE,
  assertHiddenStemProfileCoverage,
} from '../../src/bazi/foundation-profile.mjs';
import {
  branchElementCodeOf,
  deriveBaziStructuralCodes,
  deriveBaziStructuralCodesFromCoordinate,
  elementRelationCodeOf,
  growthStageCodeOf,
  hiddenStemCodesOf,
  tenGodCodeOf,
} from '../../src/bazi/structure.mjs';
import { SAMPLE_SNAPSHOT } from '../helpers.mjs';

const valueCode = (domain, id) => {
  const row = BAZI_STRUCTURAL_CODEBOOK.domains[domain].values.find((item) => item.id === id);
  assert.ok(row, `${domain}.${id} must exist`);
  return row.code;
};

function assertDeepFrozen(value, path = 'value', seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`, seen);
}

test('structural codebook has fixed widths, unique in-range codes and stable anchors', () => {
  const expected = {
    elements: [3, 5],
    polarities: [1, 2],
    elementRelations: [3, 5],
    tenGods: [4, 10],
    stems: [4, 10],
    branches: [4, 12],
    hiddenStemOrders: [2, 3],
    growthStages: [4, 12],
  };
  for (const [domainId, [bitWidth, valueCount]] of Object.entries(expected)) {
    const domain = BAZI_STRUCTURAL_CODEBOOK.domains[domainId];
    assert.equal(domain.bitWidth, bitWidth);
    assert.equal(domain.valueCount, valueCount);
    assert.equal(domain.reservedCodeCount, (2 ** bitWidth) - valueCount);
    const codes = domain.values.map((row) => row.code);
    assert.equal(new Set(codes).size, valueCount);
    assert.ok(codes.every((code) => Number.isInteger(code) && code >= 0 && code < 2 ** bitWidth));
  }

  assert.equal(valueCode('elements', 'wood'), 0);
  assert.equal(valueCode('elements', 'water'), 4);
  assert.equal(valueCode('polarities', 'yang'), 0);
  assert.equal(valueCode('polarities', 'yin'), 1);
  assert.equal(valueCode('elementRelations', 'same'), 0);
  assert.equal(valueCode('elementRelations', 'generated_by'), 2);
  assert.equal(valueCode('elementRelations', 'controlled_by'), 4);
  assert.equal(valueCode('tenGods', 'peer'), 0);
  assert.equal(valueCode('tenGods', 'direct_resource'), 9);
  assert.equal(valueCode('stems', 'jia'), 0);
  assert.equal(valueCode('stems', 'gui'), 9);
  assert.equal(valueCode('branches', 'zi'), 0);
  assert.equal(valueCode('branches', 'hai'), 11);
  assert.equal(valueCode('hiddenStemOrders', 'position_2'), 2);
  assert.equal(valueCode('growthStages', 'chang_sheng'), 0);
  assert.equal(valueCode('growthStages', 'yang'), 11);
});

test('hidden-stem profile coverage invariant rejects a missing branch', () => {
  assert.equal(assertHiddenStemProfileCoverage(HIDDEN_STEM_PROFILE), true);
  const branches = { ...HIDDEN_STEM_PROFILE.branches };
  delete branches.zi;
  assert.throws(
    () => assertHiddenStemProfileCoverage({ branches }),
    /must cover every branch/,
  );
});

test('directed element relation codes cover the complete 5 by 5 matrix', () => {
  const elements = ['wood', 'fire', 'earth', 'metal', 'water'];
  const relationMatrix = [
    ['same', 'generates', 'controls', 'controlled_by', 'generated_by'],
    ['generated_by', 'same', 'generates', 'controls', 'controlled_by'],
    ['controlled_by', 'generated_by', 'same', 'generates', 'controls'],
    ['controls', 'controlled_by', 'generated_by', 'same', 'generates'],
    ['generates', 'controls', 'controlled_by', 'generated_by', 'same'],
  ];
  let checked = 0;
  for (let fromIndex = 0; fromIndex < elements.length; fromIndex += 1) {
    for (let toIndex = 0; toIndex < elements.length; toIndex += 1) {
      assert.equal(
        elementRelationCodeOf(elements[fromIndex], elements[toIndex]),
        valueCode('elementRelations', relationMatrix[fromIndex][toIndex]),
      );
      checked += 1;
    }
  }
  assert.equal(checked, 25);
});

test('ten-god codes cover the complete 10 by 10 stem matrix', () => {
  const matrix = [
    ['peer', 'rob_wealth', 'food_god', 'hurting_officer', 'indirect_wealth', 'direct_wealth', 'seven_killings', 'direct_officer', 'indirect_resource', 'direct_resource'],
    ['rob_wealth', 'peer', 'hurting_officer', 'food_god', 'direct_wealth', 'indirect_wealth', 'direct_officer', 'seven_killings', 'direct_resource', 'indirect_resource'],
    ['indirect_resource', 'direct_resource', 'peer', 'rob_wealth', 'food_god', 'hurting_officer', 'indirect_wealth', 'direct_wealth', 'seven_killings', 'direct_officer'],
    ['direct_resource', 'indirect_resource', 'rob_wealth', 'peer', 'hurting_officer', 'food_god', 'direct_wealth', 'indirect_wealth', 'direct_officer', 'seven_killings'],
    ['seven_killings', 'direct_officer', 'indirect_resource', 'direct_resource', 'peer', 'rob_wealth', 'food_god', 'hurting_officer', 'indirect_wealth', 'direct_wealth'],
    ['direct_officer', 'seven_killings', 'direct_resource', 'indirect_resource', 'rob_wealth', 'peer', 'hurting_officer', 'food_god', 'direct_wealth', 'indirect_wealth'],
    ['indirect_wealth', 'direct_wealth', 'seven_killings', 'direct_officer', 'indirect_resource', 'direct_resource', 'peer', 'rob_wealth', 'food_god', 'hurting_officer'],
    ['direct_wealth', 'indirect_wealth', 'direct_officer', 'seven_killings', 'direct_resource', 'indirect_resource', 'rob_wealth', 'peer', 'hurting_officer', 'food_god'],
    ['food_god', 'hurting_officer', 'indirect_wealth', 'direct_wealth', 'seven_killings', 'direct_officer', 'indirect_resource', 'direct_resource', 'peer', 'rob_wealth'],
    ['hurting_officer', 'food_god', 'direct_wealth', 'indirect_wealth', 'direct_officer', 'seven_killings', 'direct_resource', 'indirect_resource', 'rob_wealth', 'peer'],
  ];
  let checked = 0;
  for (let dayIndex = 0; dayIndex < STEM_IDS.length; dayIndex += 1) {
    for (let targetIndex = 0; targetIndex < STEM_IDS.length; targetIndex += 1) {
      assert.equal(
        tenGodCodeOf(STEM_IDS[dayIndex], STEM_IDS[targetIndex]),
        valueCode('tenGods', matrix[dayIndex][targetIndex]),
      );
      checked += 1;
    }
  }
  assert.equal(checked, 100);
});

test('hidden stems preserve the stated modern common order as neutral indices only', () => {
  const expected = {
    zi: ['gui'],
    chou: ['ji', 'gui', 'xin'],
    yin: ['jia', 'bing', 'wu'],
    mao: ['yi'],
    chen: ['wu', 'yi', 'gui'],
    si: ['bing', 'wu', 'geng'],
    wu: ['ding', 'ji'],
    wei: ['ji', 'ding', 'yi'],
    shen: ['geng', 'ren', 'wu'],
    you: ['xin'],
    xu: ['wu', 'xin', 'ding'],
    hai: ['ren', 'jia'],
  };
  for (const branchId of BRANCH_IDS) {
    const rows = hiddenStemCodesOf(branchId);
    assert.deepEqual(rows.map((row) => row.stemId), expected[branchId]);
    assert.deepEqual(rows.map((row) => row.orderIndex), expected[branchId].map((_, index) => index));
    assert.deepEqual(rows.map((row) => row.stemCode), expected[branchId].map((stemId) => STEM_IDS.indexOf(stemId)));
    assert.ok(rows.every((row) => !('weight' in row) && !('role' in row)));
  }
  assert.equal(HIDDEN_STEM_PROFILE.orderSemantics, 'neutral_order_index_only');
  assert.equal(HIDDEN_STEM_PROFILE.weightInferred, false);
});

test('branches expose only their nominal element code, never hidden-stem strength', () => {
  const expected = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];
  assert.deepEqual(BRANCH_IDS.map((branchId) => branchElementCodeOf(branchId)), expected);
  assert.deepEqual(
    BAZI_STRUCTURAL_CODEBOOK.domains.branches.values.map((row) => row.polarityId),
    ['yang', 'yin', 'yang', 'yin', 'yang', 'yin', 'yang', 'yin', 'yang', 'yin', 'yang', 'yin'],
  );
});

test('growth-stage profile covers all 10 by 12 combinations with yang-forward yin-reverse motion', () => {
  const start = {
    jia: 'hai', yi: 'wu', bing: 'yin', ding: 'you', wu: 'yin',
    ji: 'you', geng: 'si', xin: 'zi', ren: 'shen', gui: 'mao',
  };
  assert.equal(GROWTH_STAGE_PROFILE.id, GROWTH_STAGE_PROFILE_ID);
  assert.equal(GROWTH_STAGE_PROFILE.conventionStatus, 'explicit_non_unique_traditional_convention');
  let checked = 0;
  for (let stemIndex = 0; stemIndex < STEM_IDS.length; stemIndex += 1) {
    const stemId = STEM_IDS[stemIndex];
    const startIndex = BRANCH_IDS.indexOf(start[stemId]);
    const direction = stemIndex % 2 === 0 ? 1 : -1;
    for (let branchIndex = 0; branchIndex < BRANCH_IDS.length; branchIndex += 1) {
      const expected = ((direction * (branchIndex - startIndex)) % 12 + 12) % 12;
      assert.equal(growthStageCodeOf(stemId, BRANCH_IDS[branchIndex]), expected);
      checked += 1;
    }
  }
  assert.equal(checked, 120);
  for (const [stemId, branchId] of Object.entries(start)) {
    assert.equal(growthStageCodeOf(stemId, branchId), 0);
  }
});

test('derivation emits frozen raw material and codes without strength, transformation or effects', () => {
  const result = deriveBaziStructuralCodes(SAMPLE_SNAPSHOT.pillars);
  const coordinate = buildValidatedPillarCoordinate(SAMPLE_SNAPSHOT.pillars);
  assert.deepEqual(deriveBaziStructuralCodesFromCoordinate(coordinate), result);
  assert.equal('deriveBaziStructuralCodesFromCoordinate' in publicApi, false);
  assert.equal(result.structuralProfileId, 'bazi.structural_foundation_profile.v1');
  assert.deepEqual(result.policy, {
    materialStatus: 'raw_structural',
    productAuthority: false,
    effectEligible: false,
    dayMasterSelfTenGod: 'peer_raw_relation',
    hiddenStemOrderSemantics: 'neutral_order_index_only',
    hiddenStemWeightInferred: false,
    strengthInferred: false,
    transformationInferred: false,
    favorabilityInferred: false,
  });
  assert.deepEqual(result.dayMaster, {
    stemId: 'jia', stemCode: 0,
    elementId: 'wood', elementCode: 0,
    polarityId: 'yang', polarityCode: 0,
  });
  assert.equal(result.pillars.year.fromDayMaster.tenGodId, 'peer');
  assert.deepEqual(result.pillars.month.branch, {
    branchId: 'yin', branchCode: 2,
    nominalElementId: 'wood', nominalElementCode: 0,
    polarityId: 'yang', polarityCode: 0,
  });
  assert.equal(result.pillars.month.fromDayMaster.tenGodId, 'food_god');
  assert.deepEqual(result.pillars.month.hiddenStems.map((row) => row.stem.stemId), ['jia', 'bing', 'wu']);
  assert.deepEqual(result.pillars.month.hiddenStems.map((row) => row.orderIndex), [0, 1, 2]);
  assert.equal(result.pillars.month.growthStage.stageId, 'lin_guan');
  assert.equal(result.pillars.month.growthStage.stageCode, 3);
  for (const forbidden of ['usefulGod', 'strength', 'transformation', 'interactions', 'effects']) {
    assert.equal(forbidden in result, false);
  }
  assertDeepFrozen(result);
});

test('invalid identifiers, profiles and pillar records are rejected', () => {
  assert.throws(() => elementRelationCodeOf('void', 'wood'), /unknown source element/);
  assert.throws(() => elementRelationCodeOf('wood', 'void'), /unknown target element/);
  assert.throws(() => tenGodCodeOf('void', 'jia'), /unknown day stem/);
  assert.throws(() => tenGodCodeOf('jia', 'void'), /unknown target stem/);
  assert.throws(() => hiddenStemCodesOf('void'), /unknown branch/);
  assert.throws(() => branchElementCodeOf('void'), /unknown branch/);
  assert.throws(() => growthStageCodeOf('void', 'zi'), /unknown day stem/);
  assert.throws(() => growthStageCodeOf('jia', 'void'), /unknown target branch/);
  assert.throws(() => growthStageCodeOf('jia', 'zi', 'another_profile'), /unknown growth-stage profile/);
  assert.throws(() => deriveBaziStructuralCodes(null), /pillars must be an object/);
  assert.throws(() => deriveBaziStructuralCodes({ ...SAMPLE_SNAPSHOT.pillars, extra: {} }), /unknown fields/);
  assert.throws(() => deriveBaziStructuralCodes({
    ...SAMPLE_SNAPSHOT.pillars,
    year: { ...SAMPLE_SNAPSHOT.pillars.year, extra: true },
  }), /unknown fields/);
  assert.throws(() => deriveBaziStructuralCodes({
    ...SAMPLE_SNAPSHOT.pillars,
    month: { stemId: 'wu', branchId: 'yin' },
  }), /month stem mismatch/);
});

test('codebook, profiles and every nested lookup value are deeply frozen', () => {
  assertDeepFrozen(BAZI_STRUCTURAL_CODEBOOK);
  assertDeepFrozen(BAZI_STRUCTURAL_PROFILE);
  assertDeepFrozen(HIDDEN_STEM_PROFILE);
  assertDeepFrozen(GROWTH_STAGE_PROFILE);
  assert.throws(() => BAZI_STRUCTURAL_CODEBOOK.domains.elements.values.push({}), TypeError);
  assert.throws(() => { BAZI_STRUCTURAL_CODEBOOK.domains.elements.values[0].code = 7; }, TypeError);
  assert.throws(() => { HIDDEN_STEM_PROFILE.branches.zi[0] = 'jia'; }, TypeError);
  assert.throws(() => { GROWTH_STAGE_PROFILE.birthStartBranchByStem.jia = 'zi'; }, TypeError);
});
