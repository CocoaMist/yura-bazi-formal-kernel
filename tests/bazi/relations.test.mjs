import test from 'node:test';
import assert from 'node:assert/strict';
import { BRANCH_IDS, PILLAR_SLOTS, STEM_IDS } from '../../src/bazi/constants.mjs';
import {
  BAZI_STRUCTURAL_CODEBOOK,
  BAZI_STRUCTURAL_CODEBOOK_VERSION,
} from '../../src/bazi/foundation-profile.mjs';
import {
  BAZI_RELATION_CODEBOOK,
  BAZI_RELATION_PROFILE,
  BAZI_RELATION_PROFILE_ID,
} from '../../src/bazi/relation-profile.mjs';
import {
  BAZI_RELATION_MATERIALS_VERSION,
  assertRelationFoundationBinding,
  assertRelationLookupTableWidths,
  deriveBaziRelationMaterials,
  deriveBaziRelationMaterialsFromCoordinate,
  deriveBaziRelationSignatureFromCoordinate,
  punishmentDirection,
} from '../../src/bazi/relations.mjs';
import { SAMPLE_SNAPSHOT } from '../helpers.mjs';

const STEM_COMBINATION_ORACLE_10X10 = [
  [0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
];

test('relation initialization invariants are explicit and independently testable', () => {
  assert.equal(
    assertRelationFoundationBinding(BAZI_RELATION_PROFILE, BAZI_STRUCTURAL_CODEBOOK_VERSION),
    true,
  );
  assert.throws(
    () => assertRelationFoundationBinding(BAZI_RELATION_PROFILE, 'bazi.structural_codebook.other'),
    /must bind the active structural codebook version/,
  );

  const expectedWidths = {
    stemElementBytes: 10,
    branchElementBytes: 12,
    elementRelationBytes: 25,
    stemCombinationBytes: 100,
    branchPairRelationBytes: 144,
  };
  assert.equal(assertRelationLookupTableWidths(expectedWidths), true);
  for (const field of Object.keys(expectedWidths)) {
    assert.throws(
      () => assertRelationLookupTableWidths({ ...expectedWidths, [field]: 0 }),
      /lookup tables must remain/,
      field,
    );
  }
});

const STEM_ELEMENT_RELATION_ORACLE_10X10 = [
  [0, 0, 1, 1, 3, 3, 4, 4, 2, 2],
  [0, 0, 1, 1, 3, 3, 4, 4, 2, 2],
  [2, 2, 0, 0, 1, 1, 3, 3, 4, 4],
  [2, 2, 0, 0, 1, 1, 3, 3, 4, 4],
  [4, 4, 2, 2, 0, 0, 1, 1, 3, 3],
  [4, 4, 2, 2, 0, 0, 1, 1, 3, 3],
  [3, 3, 4, 4, 2, 2, 0, 0, 1, 1],
  [3, 3, 4, 4, 2, 2, 0, 0, 1, 1],
  [1, 1, 3, 3, 4, 4, 2, 2, 0, 0],
  [1, 1, 3, 3, 4, 4, 2, 2, 0, 0],
];

const STEM_CORRESPONDENCE_ELEMENT_CODE_ORACLE_10X10 = [
  [null, null, null, null, null, 2, null, null, null, null],
  [null, null, null, null, null, null, 3, null, null, null],
  [null, null, null, null, null, null, null, 4, null, null],
  [null, null, null, null, null, null, null, null, 0, null],
  [null, null, null, null, null, null, null, null, null, 1],
  [2, null, null, null, null, null, null, null, null, null],
  [null, 3, null, null, null, null, null, null, null, null],
  [null, null, 4, null, null, null, null, null, null, null],
  [null, null, null, 0, null, null, null, null, null, null],
  [null, null, null, null, 1, null, null, null, null, null],
];

const ELEMENT_RELATION_ORACLE_5X5 = [
  [0, 1, 3, 4, 2],
  [2, 0, 1, 3, 4],
  [4, 2, 0, 1, 3],
  [3, 4, 2, 0, 1],
  [1, 3, 4, 2, 0],
];

const BRANCH_NOMINAL_ELEMENT_CODE_ORACLE_12 = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];

// Bit order: 六合=1, 冲=2, 刑=4, 害=8, 破=16.
// This literal matrix is intentionally independent of the implementation profile.
const BRANCH_RELATION_ORACLE_12X12 = [
  [0, 1, 0, 4, 0, 0, 2, 8, 0, 16, 0, 0],
  [1, 0, 0, 0, 16, 0, 8, 6, 0, 0, 4, 0],
  [0, 0, 0, 0, 0, 12, 0, 0, 6, 0, 0, 17],
  [4, 0, 0, 0, 8, 0, 16, 0, 0, 2, 1, 0],
  [0, 16, 0, 8, 4, 0, 0, 0, 0, 1, 2, 0],
  [0, 0, 12, 0, 0, 0, 0, 0, 21, 0, 0, 2],
  [2, 8, 0, 16, 0, 0, 4, 1, 0, 0, 0, 0],
  [8, 6, 0, 0, 0, 0, 1, 0, 0, 0, 20, 0],
  [0, 0, 6, 0, 0, 21, 0, 0, 0, 0, 0, 8],
  [16, 0, 0, 2, 1, 0, 0, 0, 0, 4, 8, 0],
  [0, 4, 0, 1, 2, 0, 0, 20, 0, 8, 0, 0],
  [0, 0, 17, 0, 0, 2, 0, 0, 8, 0, 0, 4],
];

function coordinate(stemCodes4 = [0, 0, 0, 0], branchCodes4 = [0, 0, 0, 0]) {
  const stemSlotMasks4ByCode10 = new Array(10).fill(0);
  const branchSlotMasks4ByCode12 = new Array(12).fill(0);
  let visibleStemPresenceMask10 = 0;
  let branchPresenceMask12 = 0;
  for (let slotIndex = 0; slotIndex < 4; slotIndex += 1) {
    const stemCode = stemCodes4[slotIndex];
    const branchCode = branchCodes4[slotIndex];
    visibleStemPresenceMask10 |= 1 << stemCode;
    branchPresenceMask12 |= 1 << branchCode;
    stemSlotMasks4ByCode10[stemCode] |= 1 << slotIndex;
    branchSlotMasks4ByCode12[branchCode] |= 1 << slotIndex;
  }
  return Object.freeze({
    pillarCode24: 0,
    index19: 0,
    stemCodes4: Object.freeze([...stemCodes4]),
    branchCodes4: Object.freeze([...branchCodes4]),
    sexagenaryCodes4: Object.freeze([0, 0, 0, 0]),
    visibleStemPresenceMask10,
    branchPresenceMask12,
    stemSlotMasks4ByCode10: Object.freeze(stemSlotMasks4ByCode10),
    branchSlotMasks4ByCode12: Object.freeze(branchSlotMasks4ByCode12),
  });
}

function assertDeepFrozen(value, path = 'value', seen = new Set()) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`, seen);
}

test('relation codebook and profile expose fixed candidate semantics without authority', () => {
  assert.equal(BAZI_RELATION_CODEBOOK.version, 'bazi.relation_codebook.v3');
  assert.equal(BAZI_RELATION_CODEBOOK.foundationCodebookVersion, BAZI_STRUCTURAL_CODEBOOK_VERSION);
  assert.equal(BAZI_RELATION_PROFILE.foundationCodebookVersion, BAZI_STRUCTURAL_CODEBOOK_VERSION);
  assert.strictEqual(BAZI_RELATION_CODEBOOK.domains.elements, BAZI_STRUCTURAL_CODEBOOK.domains.elements);
  assert.strictEqual(
    BAZI_RELATION_CODEBOOK.domains.elementRelations,
    BAZI_STRUCTURAL_CODEBOOK.domains.elementRelations,
  );
  assert.equal(BAZI_RELATION_PROFILE.id, BAZI_RELATION_PROFILE_ID);
  assert.equal(BAZI_RELATION_PROFILE_ID, 'bazi.relation_foundation.modern_common_raw_structure.v4');
  assert.deepEqual(BAZI_RELATION_PROFILE.policy, {
    materialStatus: 'raw_relation_candidate',
    productAuthority: false,
    effectEligible: false,
    transformationInferred: false,
    strengthInferred: false,
    favorabilityInferred: false,
    directionalityInferred: false,
    precedenceInferred: false,
  });
  assert.deepEqual(BAZI_RELATION_PROFILE.scope, {
    stemCombinationParticipants: 'visible_stems_only',
    stemElementRelationBasis: 'stem_element',
    branchPairSemantics: 'symmetric_multi_label_except_profile_ordered_punishment',
    branchElementRelationBasis: 'nominal_element_only',
    branchDirectionality: 'punishment_uses_ordered_profile_pairs',
    hyperedgeAdmission: 'complete_membership_only',
    hyperedgeRealization: 'occurrence_cartesian_product',
    partialRealization: 'present_member_occurrence_cartesian_product',
    selfPunishment: {
      allowSelfLoop: false,
      minimumDistinctOccurrences: 2,
      enumeration: 'all_distinct_occurrence_pairs',
    },
  });
  assert.deepEqual(BAZI_RELATION_PROFILE.excludedDerivations, [
    'half_harmony',
    'arching_harmony',
    'dark_harmony',
    'competing_combination',
    'combination_binding',
    'combination_transformation',
  ]);
  assert.deepEqual(
    BAZI_RELATION_PROFILE.stemCombinationPairs.map((row) => [
      row.memberStemIds.join('_'), row.traditionalCorrespondenceElementId,
    ]),
    [
      ['jia_ji', 'earth'],
      ['yi_geng', 'metal'],
      ['bing_xin', 'water'],
      ['ding_ren', 'wood'],
      ['wu_gui', 'fire'],
    ],
  );
  assert.equal(BAZI_RELATION_CODEBOOK.domains.elementRelations.bitWidth, 3);
  assert.equal(BAZI_RELATION_CODEBOOK.domains.stemCombinationFlags.bitWidth, 1);
  assert.equal(BAZI_RELATION_CODEBOOK.domains.branchPairRelationFlags.bitWidth, 5);
  assert.equal(BAZI_RELATION_CODEBOOK.domains.pillarPairs.valueCount, 6);
  assert.equal(BAZI_RELATION_CODEBOOK.domains.completeHyperedgeGroups.valueCount, 10);
  assert.deepEqual(
    BAZI_RELATION_CODEBOOK.domains.branchPairRelationFlags.values.map((row) => row.bitMask),
    [1, 2, 4, 8, 16],
  );
  assertDeepFrozen(BAZI_RELATION_CODEBOOK);
  assertDeepFrozen(BAZI_RELATION_PROFILE);
});

test('stem lookup covers the independent 10 by 10 five-combination and directed-element oracles', () => {
  let checked = 0;
  for (let leftStemCode = 0; leftStemCode < 10; leftStemCode += 1) {
    for (let rightStemCode = 0; rightStemCode < 10; rightStemCode += 1) {
      const inputCoordinate = coordinate(
        [leftStemCode, rightStemCode, 0, 0],
        [0, 0, 0, 0],
      );
      const signature = deriveBaziRelationSignatureFromCoordinate(inputCoordinate);
      const pair = deriveBaziRelationMaterialsFromCoordinate(inputCoordinate).pairs.stems[0];
      const expectedCorrespondenceCode
        = STEM_CORRESPONDENCE_ELEMENT_CODE_ORACLE_10X10[leftStemCode][rightStemCode];
      assert.equal(signature.stemCombinationPairMask6 & 1, STEM_COMBINATION_ORACLE_10X10[leftStemCode][rightStemCode]);
      assert.equal(signature.stemElementRelationCodes18 & 0b111, STEM_ELEMENT_RELATION_ORACLE_10X10[leftStemCode][rightStemCode]);
      assert.equal(pair.leftToRightElementRelationCode, STEM_ELEMENT_RELATION_ORACLE_10X10[leftStemCode][rightStemCode]);
      assert.equal(pair.rightToLeftElementRelationCode, STEM_ELEMENT_RELATION_ORACLE_10X10[rightStemCode][leftStemCode]);
      assert.equal(pair.traditionalCorrespondenceElementCode, expectedCorrespondenceCode);
      assert.equal(
        pair.traditionalCorrespondenceElementId,
        expectedCorrespondenceCode == null
          ? null
          : ['wood', 'fire', 'earth', 'metal', 'water'][expectedCorrespondenceCode],
      );
      checked += 1;
    }
  }
  assert.equal(checked, 100);
});

test('branch lookup covers the complete independent 12 by 12 multi-label oracle', () => {
  let checked = 0;
  for (let leftBranchCode = 0; leftBranchCode < 12; leftBranchCode += 1) {
    for (let rightBranchCode = 0; rightBranchCode < 12; rightBranchCode += 1) {
      const inputCoordinate = coordinate(
        [0, 0, 0, 0],
        [leftBranchCode, rightBranchCode, 0, 0],
      );
      const signature = deriveBaziRelationSignatureFromCoordinate(inputCoordinate);
      const material = deriveBaziRelationMaterialsFromCoordinate(inputCoordinate);
      const pair = material.pairs.branches[0];
      const leftElementCode = BRANCH_NOMINAL_ELEMENT_CODE_ORACLE_12[leftBranchCode];
      const rightElementCode = BRANCH_NOMINAL_ELEMENT_CODE_ORACLE_12[rightBranchCode];
      assert.equal(signature.branchPairRelationMasks30 & 0b1_1111, BRANCH_RELATION_ORACLE_12X12[leftBranchCode][rightBranchCode]);
      assert.equal(
        signature.branchElementRelationCodes18 & 0b111,
        ELEMENT_RELATION_ORACLE_5X5[leftElementCode][rightElementCode],
      );
      assert.equal(material.occurrences.branches[0].nominalElementCode, leftElementCode);
      assert.equal(material.occurrences.branches[1].nominalElementCode, rightElementCode);
      assert.equal(pair.leftToRightElementRelationCode, ELEMENT_RELATION_ORACLE_5X5[leftElementCode][rightElementCode]);
      assert.equal(pair.rightToLeftElementRelationCode, ELEMENT_RELATION_ORACLE_5X5[rightElementCode][leftElementCode]);
      checked += 1;
    }
  }
  assert.equal(checked, 144);
});

test('overlapping pair labels survive and forward/reverse element fields remain explicit', () => {
  const result = deriveBaziRelationMaterialsFromCoordinate(coordinate(
    [0, 5, 0, 0],
    [2, 11, 5, 8],
  ));
  const stemPair = result.pairs.stems[0];
  assert.equal(stemPair.leftStemId, 'jia');
  assert.equal(stemPair.rightStemId, 'ji');
  assert.equal(stemPair.relationMask1, 1);
  assert.equal(stemPair.combinationCandidate, true);
  assert.equal(stemPair.traditionalCorrespondenceElementId, 'earth');
  assert.equal(stemPair.traditionalCorrespondenceElementCode, 2);
  assert.equal(stemPair.leftToRightElementRelationId, 'controls');
  assert.equal(stemPair.leftToRightElementRelationCode, 3);
  assert.equal(stemPair.rightToLeftElementRelationId, 'controlled_by');
  assert.equal(stemPair.rightToLeftElementRelationCode, 4);

  const yinHai = result.pairs.branches[0];
  assert.equal(yinHai.relationMask5, 17);
  assert.deepEqual(yinHai.relationIds, ['six_harmony', 'break']);
  assert.equal(yinHai.leftToRightElementRelationId, 'generated_by');
  assert.equal(yinHai.rightToLeftElementRelationId, 'generates');

  const siShen = result.pairs.branches[5];
  assert.equal(siShen.relationMask5, 21);
  assert.deepEqual(siShen.relationIds, ['six_harmony', 'punishment', 'break']);
  assert.equal(siShen.leftToRightElementRelationId, 'controls');
  assert.equal(siShen.rightToLeftElementRelationId, 'controlled_by');

  const reversed = deriveBaziRelationMaterialsFromCoordinate(coordinate(
    [5, 0, 0, 0],
    [11, 2, 8, 5],
  ));
  assert.equal(reversed.pairs.stems[0].relationMask1, stemPair.relationMask1);
  assert.equal(reversed.pairs.stems[0].leftToRightElementRelationCode, stemPair.rightToLeftElementRelationCode);
  assert.equal(reversed.pairs.stems[0].rightToLeftElementRelationCode, stemPair.leftToRightElementRelationCode);
  assert.equal(reversed.pairs.branches[0].relationMask5, yinHai.relationMask5);
  assert.equal(reversed.pairs.branches[0].leftToRightElementRelationCode, yinHai.rightToLeftElementRelationCode);
  assert.equal(reversed.pairs.branches[0].rightToLeftElementRelationCode, yinHai.leftToRightElementRelationCode);
});

test('self-punishment is occurrence-aware across all C(n,2) fixed slot pairs', () => {
  const result = deriveBaziRelationMaterialsFromCoordinate(coordinate(
    [0, 0, 0, 0],
    [4, 4, 4, 4],
  ));
  assert.equal(result.pairs.branches.length, 6);
  assert.equal(result.pairs.branches.filter((pair) => pair.relationIds.includes('punishment')).length, 6);
  assert.deepEqual(result.pairs.branches.map((pair) => pair.participantRefs), [
    ['pillar.year.branch', 'pillar.month.branch'],
    ['pillar.year.branch', 'pillar.day.branch'],
    ['pillar.year.branch', 'pillar.hour.branch'],
    ['pillar.month.branch', 'pillar.day.branch'],
    ['pillar.month.branch', 'pillar.hour.branch'],
    ['pillar.day.branch', 'pillar.hour.branch'],
  ]);
});

test('all ten group definitions require complete membership and expand repeated members by Cartesian product', () => {
  for (const group of BAZI_RELATION_PROFILE.completeHyperedgeGroups) {
    const memberCodes = group.memberBranchIds.map((branchId) => BRANCH_IDS.indexOf(branchId));
    const complete = deriveBaziRelationMaterialsFromCoordinate(coordinate(
      [0, 0, 0, 0],
      [memberCodes[0], memberCodes[1], memberCodes[2], memberCodes[1]],
    ));
    assert.equal((complete.accelerators.completeGroupMask10 >>> group.code) & 1, 1, group.id);
    const realizations = complete.hyperedges.filter((edge) => edge.groupId === group.id);
    assert.equal(realizations.length, 2, group.id);
    assert.deepEqual(realizations.map((edge) => edge.participantRefs), [
      ['pillar.year.branch', 'pillar.month.branch', 'pillar.day.branch'],
      ['pillar.year.branch', 'pillar.hour.branch', 'pillar.day.branch'],
    ]);
    assert.ok(realizations.every((edge) => edge.completeOnly === true));
    assert.ok(realizations.every((edge) => edge.participantSlotMask4 === 0b0111 || edge.participantSlotMask4 === 0b1101));

    const incomplete = deriveBaziRelationMaterialsFromCoordinate(coordinate(
      [0, 0, 0, 0],
      [memberCodes[0], memberCodes[1], memberCodes[0], memberCodes[1]],
    ));
    assert.equal((incomplete.accelerators.completeGroupMask10 >>> group.code) & 1, 0, group.id);
    assert.equal(incomplete.hyperedges.some((edge) => edge.groupId === group.id), false);
  }
});

test('compact accelerators exactly recompose the six pair and ten group material lanes', () => {
  const result = deriveBaziRelationMaterialsFromCoordinate(coordinate(
    [0, 5, 3, 8],
    [5, 8, 2, 11],
  ));
  let stemMask6 = 0;
  let branchMasks30 = 0;
  let stemRelations18 = 0;
  let branchRelations18 = 0;
  for (let pairIndex = 0; pairIndex < 6; pairIndex += 1) {
    stemMask6 |= result.pairs.stems[pairIndex].relationMask1 << pairIndex;
    branchMasks30 |= result.pairs.branches[pairIndex].relationMask5 << (pairIndex * 5);
    stemRelations18 |= result.pairs.stems[pairIndex].leftToRightElementRelationCode << (pairIndex * 3);
    branchRelations18 |= result.pairs.branches[pairIndex].leftToRightElementRelationCode << (pairIndex * 3);
  }
  const groupMask10 = result.hyperedges.reduce((mask, edge) => mask | (1 << edge.groupCode), 0);
  assert.equal(result.accelerators.stemCombinationPairMask6, stemMask6);
  assert.equal(result.accelerators.branchPairRelationMasks30, branchMasks30 >>> 0);
  assert.equal(result.accelerators.stemElementRelationCodes18, stemRelations18);
  assert.equal(result.accelerators.branchElementRelationCodes18, branchRelations18);
  assert.equal(result.accelerators.completeGroupMask10, groupMask10);
  assert.ok(result.accelerators.visibleStemPresenceMask10 < 2 ** 10);
  assert.ok(result.accelerators.branchPresenceMask12 < 2 ** 12);
  assert.ok(result.accelerators.stemCombinationPairMask6 < 2 ** 6);
  assert.ok(result.accelerators.branchPairRelationMasks30 < 2 ** 30);
  assert.ok(result.accelerators.stemElementRelationCodes18 < 2 ** 18);
  assert.ok(result.accelerators.branchElementRelationCodes18 < 2 ** 18);
  assert.ok(result.accelerators.completeGroupMask10 < 2 ** 10);
});

test('public derivation validates once and emits only deeply frozen raw candidate material', () => {
  const result = deriveBaziRelationMaterials(SAMPLE_SNAPSHOT.pillars);
  assert.equal(result.version, BAZI_RELATION_MATERIALS_VERSION);
  assert.equal(result.profileId, BAZI_RELATION_PROFILE_ID);
  assert.equal(result.occurrences.stems.length, 4);
  assert.equal(result.occurrences.branches.length, 4);
  assert.equal(result.pairs.stems.length, 6);
  assert.equal(result.pairs.branches.length, 6);
  assert.equal(result.hyperedges.length, 0);
  assert.deepEqual(result.occurrences.stems.map((row) => row.slot), PILLAR_SLOTS);
  assert.deepEqual(result.occurrences.stems.map((row) => row.occurrenceRef), [
    'pillar.year.visible_stem',
    'pillar.month.visible_stem',
    'pillar.day.visible_stem',
    'pillar.hour.visible_stem',
  ]);
  assert.deepEqual(result.occurrences.branches.map((row) => row.occurrenceRef), [
    'pillar.year.branch',
    'pillar.month.branch',
    'pillar.day.branch',
    'pillar.hour.branch',
  ]);
  assert.deepEqual(result.occurrences.stems.map((row) => row.stemId), ['jia', 'bing', 'jia', 'jia']);
  assert.deepEqual(result.occurrences.branches.map((row) => row.branchId), ['zi', 'yin', 'zi', 'zi']);
  assert.deepEqual(result.pairs.stems.map((pair) => pair.participantRefs), [
    ['pillar.year.visible_stem', 'pillar.month.visible_stem'],
    ['pillar.year.visible_stem', 'pillar.day.visible_stem'],
    ['pillar.year.visible_stem', 'pillar.hour.visible_stem'],
    ['pillar.month.visible_stem', 'pillar.day.visible_stem'],
    ['pillar.month.visible_stem', 'pillar.hour.visible_stem'],
    ['pillar.day.visible_stem', 'pillar.hour.visible_stem'],
  ]);
  for (const pair of result.pairs.stems) {
    assert.deepEqual(pair.participantRefs, [
      result.occurrences.stems[pair.leftOccurrenceIndex].occurrenceRef,
      result.occurrences.stems[pair.rightOccurrenceIndex].occurrenceRef,
    ]);
  }
  for (const pair of result.pairs.branches) {
    assert.deepEqual(pair.participantRefs, [
      result.occurrences.branches[pair.leftOccurrenceIndex].occurrenceRef,
      result.occurrences.branches[pair.rightOccurrenceIndex].occurrenceRef,
    ]);
  }
  assert.ok(result.pairs.stems.every((pair) => pair.combinationCandidate
    || (pair.traditionalCorrespondenceElementId === null
      && pair.traditionalCorrespondenceElementCode === null)));
  for (const forbidden of [
    'halfHarmony', 'archingHarmony', 'darkHarmony', 'competingCombination',
    'combinationBinding', 'transformation', 'interactions', 'effects', 'hiddenStems',
  ]) {
    assert.equal(forbidden in result, false, forbidden);
  }
  assertDeepFrozen(result);
});

test('public derivation rejects malformed identifiers, extra fields and grammar violations', () => {
  assert.equal(punishmentDirection(BAZI_RELATION_PROFILE, 'zi', 'chou', ['a', 'b']), null);
  assert.throws(
    () => deriveBaziRelationMaterialsFromCoordinate(coordinate(), { id: 'unsupported' }),
    /unsupported RelationProfile/,
  );
  assert.throws(() => deriveBaziRelationMaterials(null), /pillars must be an object/);
  assert.throws(() => deriveBaziRelationMaterials({ ...SAMPLE_SNAPSHOT.pillars, extra: {} }), /unknown fields/);
  assert.throws(() => deriveBaziRelationMaterials({
    ...SAMPLE_SNAPSHOT.pillars,
    year: { ...SAMPLE_SNAPSHOT.pillars.year, extra: true },
  }), /unknown fields/);
  assert.throws(() => deriveBaziRelationMaterials({
    ...SAMPLE_SNAPSHOT.pillars,
    year: { stemId: 'void', branchId: 'zi' },
  }), /invalid sexagenary pillar/);
  assert.throws(() => deriveBaziRelationMaterials({
    ...SAMPLE_SNAPSHOT.pillars,
    month: { stemId: 'wu', branchId: 'yin' },
  }), /month stem mismatch/);
});

test('module outputs remain independent from state, causal and useful-god inference', () => {
  assert.equal(STEM_IDS.length, 10);
  assert.equal(BRANCH_IDS.length, 12);
  assert.throws(() => { BAZI_RELATION_PROFILE.policy.effectEligible = true; }, TypeError);
  assert.throws(() => { BAZI_RELATION_PROFILE.branchPairCandidates.six_harmony[0][0] = 'void'; }, TypeError);
  assert.throws(() => { BAZI_RELATION_CODEBOOK.domains.branchPairRelationFlags.values.push({}); }, TypeError);
});
