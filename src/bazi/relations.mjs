import {
  BRANCH_IDS,
  branchIndexOf,
  PILLAR_SLOTS,
  STEM_IDS,
  stemIndexOf,
} from './constants.mjs';
import {
  buildValidatedPillarCoordinate,
  captureValidatedPillars,
} from './encoding.mjs';
import {
  BAZI_STRUCTURAL_CODEBOOK,
  BAZI_STRUCTURAL_CODEBOOK_VERSION,
} from './foundation-profile.mjs';
import {
  BAZI_RELATION_CODEBOOK,
  BAZI_RELATION_CODEBOOK_VERSION,
  BAZI_RELATION_PROFILE,
  BAZI_RELATION_PROFILE_ID,
} from './relation-profile.mjs';
import { elementRelationCodeOf } from './structure.mjs';

export const BAZI_RELATION_MATERIALS_VERSION = 'bazi.relation_materials.v1';

export function assertRelationFoundationBinding(profile, structuralCodebookVersion) {
  if (profile.foundationCodebookVersion !== structuralCodebookVersion) {
    throw new Error('relation profile must bind the active structural codebook version');
  }
  return true;
}

assertRelationFoundationBinding(BAZI_RELATION_PROFILE, BAZI_STRUCTURAL_CODEBOOK_VERSION);

const structuralDomains = BAZI_STRUCTURAL_CODEBOOK.domains;
const elementCodeById = new Map(structuralDomains.elements.values.map((row) => [row.id, row.code]));
const ELEMENT_IDS = new Array(structuralDomains.elements.valueCount);
const STEM_ELEMENT_CODES = new Uint8Array(structuralDomains.stems.valueCount);
const BRANCH_ELEMENT_CODES = new Uint8Array(structuralDomains.branches.valueCount);
for (const row of structuralDomains.elements.values) ELEMENT_IDS[row.code] = row.id;
for (const row of structuralDomains.stems.values) {
  STEM_ELEMENT_CODES[row.code] = elementCodeById.get(row.elementId);
}
for (const row of structuralDomains.branches.values) {
  BRANCH_ELEMENT_CODES[row.code] = elementCodeById.get(row.nominalElementId);
}
Object.freeze(ELEMENT_IDS);
const PILLAR_PAIR_SLOT_INDEX_TABLE_12 = new Uint8Array([
  0, 1,
  0, 2,
  0, 3,
  1, 2,
  1, 3,
  2, 3,
]);

// These three dense byte tables are the hot path. Profile rows stay readable;
// scans never allocate maps, sets or relation objects until full material is requested.
const ELEMENT_RELATION_CODE_TABLE_25 = new Uint8Array(5 * 5);
for (const fromElement of structuralDomains.elements.values) {
  for (const toElement of structuralDomains.elements.values) {
    ELEMENT_RELATION_CODE_TABLE_25[(fromElement.code * 5) + toElement.code]
      = elementRelationCodeOf(fromElement.id, toElement.id);
  }
}
// Bit 0 is the candidate flag. Bits 1..3 store correspondence element code + 1;
// zero therefore remains the complete non-candidate sentinel.
const STEM_COMBINATION_CODE_TABLE_100 = new Uint8Array(10 * 10);
const BRANCH_PAIR_RELATION_MASK_TABLE_144 = new Uint8Array(12 * 12);

for (const combination of BAZI_RELATION_PROFILE.stemCombinationPairs) {
  const [leftStemId, rightStemId] = combination.memberStemIds;
  const leftCode = stemIndexOf(leftStemId);
  const rightCode = stemIndexOf(rightStemId);
  const correspondenceElementCode = ELEMENT_IDS.indexOf(combination.traditionalCorrespondenceElementId);
  const packedCode = 1 | ((correspondenceElementCode + 1) << 1);
  STEM_COMBINATION_CODE_TABLE_100[(leftCode * 10) + rightCode] = packedCode;
  STEM_COMBINATION_CODE_TABLE_100[(rightCode * 10) + leftCode] = packedCode;
}

const branchFlagById = new Map(
  BAZI_RELATION_CODEBOOK.domains.branchPairRelationFlags.values
    .map((row) => [row.id, row.bitMask]),
);
for (const [relationId, pairs] of Object.entries(BAZI_RELATION_PROFILE.branchPairCandidates)) {
  const bitMask = branchFlagById.get(relationId);
  for (const [leftBranchId, rightBranchId] of pairs) {
    const leftCode = branchIndexOf(leftBranchId);
    const rightCode = branchIndexOf(rightBranchId);
    BRANCH_PAIR_RELATION_MASK_TABLE_144[(leftCode * 12) + rightCode] |= bitMask;
    BRANCH_PAIR_RELATION_MASK_TABLE_144[(rightCode * 12) + leftCode] |= bitMask;
  }
}

export function assertRelationLookupTableWidths({
  stemElementBytes,
  branchElementBytes,
  elementRelationBytes,
  stemCombinationBytes,
  branchPairRelationBytes,
}) {
  if (
    stemElementBytes !== 10
    || branchElementBytes !== 12
    || elementRelationBytes !== 25
    || stemCombinationBytes !== 100
    || branchPairRelationBytes !== 144
  ) {
    throw new Error('relation lookup tables must remain 10, 12, 25, 100 and 144 bytes');
  }
  return true;
}

assertRelationLookupTableWidths({
  stemElementBytes: STEM_ELEMENT_CODES.byteLength,
  branchElementBytes: BRANCH_ELEMENT_CODES.byteLength,
  elementRelationBytes: ELEMENT_RELATION_CODE_TABLE_25.byteLength,
  stemCombinationBytes: STEM_COMBINATION_CODE_TABLE_100.byteLength,
  branchPairRelationBytes: BRANCH_PAIR_RELATION_MASK_TABLE_144.byteLength,
});

const elementRelationRows = BAZI_RELATION_CODEBOOK.domains.elementRelations.values;
const branchRelationFlagRows = BAZI_RELATION_CODEBOOK.domains.branchPairRelationFlags.values;
const pillarPairRows = BAZI_RELATION_PROFILE.fixedPillarPairs;
const hyperedgeGroupRows = BAZI_RELATION_PROFILE.completeHyperedgeGroups;
const hyperedgeRequiredMasks12 = hyperedgeGroupRows.map((group) => group.memberBranchIds.reduce(
  (mask, branchId) => mask | (1 << branchIndexOf(branchId)),
  0,
));

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function elementRelationCode(fromElementCode, toElementCode) {
  return ELEMENT_RELATION_CODE_TABLE_25[(fromElementCode * 5) + toElementCode];
}

function elementRelationFields(leftElementCode, rightElementCode) {
  const leftToRightCode = elementRelationCode(leftElementCode, rightElementCode);
  const rightToLeftCode = elementRelationCode(rightElementCode, leftElementCode);
  return {
    leftToRightElementRelationId: elementRelationRows[leftToRightCode].id,
    leftToRightElementRelationCode: leftToRightCode,
    rightToLeftElementRelationId: elementRelationRows[rightToLeftCode].id,
    rightToLeftElementRelationCode: rightToLeftCode,
  };
}

function branchRelationIds(relationMask5) {
  return branchRelationFlagRows
    .filter((row) => (relationMask5 & row.bitMask) !== 0)
    .map((row) => row.id);
}

function visibleStemOccurrenceRef(slot) {
  return `pillar.${slot}.visible_stem`;
}

function branchOccurrenceRef(slot) {
  return `pillar.${slot}.branch`;
}

function scanCompactRelations(coordinate) {
  let stemCombinationPairMask6 = 0;
  let branchPairRelationMasks30 = 0;
  let stemElementRelationCodes18 = 0;
  let branchElementRelationCodes18 = 0;

  for (let pairIndex = 0; pairIndex < pillarPairRows.length; pairIndex += 1) {
    const leftSlotIndex = PILLAR_PAIR_SLOT_INDEX_TABLE_12[pairIndex * 2];
    const rightSlotIndex = PILLAR_PAIR_SLOT_INDEX_TABLE_12[(pairIndex * 2) + 1];
    const leftStemCode = coordinate.stemCodes4[leftSlotIndex];
    const rightStemCode = coordinate.stemCodes4[rightSlotIndex];
    const leftBranchCode = coordinate.branchCodes4[leftSlotIndex];
    const rightBranchCode = coordinate.branchCodes4[rightSlotIndex];
    const stemCombinationMask1 = STEM_COMBINATION_CODE_TABLE_100[(leftStemCode * 10) + rightStemCode] & 1;
    const branchRelationMask5 = BRANCH_PAIR_RELATION_MASK_TABLE_144[(leftBranchCode * 12) + rightBranchCode];
    const stemRelationCode3 = elementRelationCode(
      STEM_ELEMENT_CODES[leftStemCode],
      STEM_ELEMENT_CODES[rightStemCode],
    );
    const branchRelationCode3 = elementRelationCode(
      BRANCH_ELEMENT_CODES[leftBranchCode],
      BRANCH_ELEMENT_CODES[rightBranchCode],
    );

    stemCombinationPairMask6 |= stemCombinationMask1 << pairIndex;
    branchPairRelationMasks30 |= branchRelationMask5 << (pairIndex * 5);
    stemElementRelationCodes18 |= stemRelationCode3 << (pairIndex * 3);
    branchElementRelationCodes18 |= branchRelationCode3 << (pairIndex * 3);
  }

  let completeGroupMask10 = 0;
  for (let groupIndex = 0; groupIndex < hyperedgeRequiredMasks12.length; groupIndex += 1) {
    const requiredMask12 = hyperedgeRequiredMasks12[groupIndex];
    if ((coordinate.branchPresenceMask12 & requiredMask12) === requiredMask12) {
      completeGroupMask10 |= 1 << groupIndex;
    }
  }

  return {
    visibleStemPresenceMask10: coordinate.visibleStemPresenceMask10,
    branchPresenceMask12: coordinate.branchPresenceMask12,
    stemCombinationPairMask6,
    branchPairRelationMasks30: branchPairRelationMasks30 >>> 0,
    stemElementRelationCodes18,
    branchElementRelationCodes18,
    completeGroupMask10,
  };
}

function occurrenceLayers(coordinate) {
  const stems = [];
  const branches = [];
  for (let slotIndex = 0; slotIndex < PILLAR_SLOTS.length; slotIndex += 1) {
    const slot = PILLAR_SLOTS[slotIndex];
    const stemCode = coordinate.stemCodes4[slotIndex];
    const branchCode = coordinate.branchCodes4[slotIndex];
    const stemElementCode = STEM_ELEMENT_CODES[stemCode];
    const branchElementCode = BRANCH_ELEMENT_CODES[branchCode];
    stems.push({
      occurrenceRef: visibleStemOccurrenceRef(slot),
      occurrenceIndex: slotIndex,
      slot,
      stemId: STEM_IDS[stemCode],
      stemCode,
      elementId: ELEMENT_IDS[stemElementCode],
      elementCode: stemElementCode,
    });
    branches.push({
      occurrenceRef: branchOccurrenceRef(slot),
      occurrenceIndex: slotIndex,
      slot,
      branchId: BRANCH_IDS[branchCode],
      branchCode,
      nominalElementId: ELEMENT_IDS[branchElementCode],
      nominalElementCode: branchElementCode,
    });
  }
  return { stems, branches };
}

export function punishmentDirection(profile, leftBranchId, rightBranchId, participantRefs) {
  if (leftBranchId === rightBranchId) {
    return {
      kind: 'self_punishment_between_distinct_occurrences',
      sourceOccurrenceRef: participantRefs[0],
      targetOccurrenceRef: participantRefs[1],
    };
  }
  const rows = profile.branchPairCandidates.punishment;
  if (rows.some(([left, right]) => left === leftBranchId && right === rightBranchId)
    && rows.some(([left, right]) => left === rightBranchId && right === leftBranchId)) {
    return {
      kind: 'bidirectional',
      sourceOccurrenceRef: participantRefs[0],
      targetOccurrenceRef: participantRefs[1],
    };
  }
  if (rows.some(([left, right]) => left === leftBranchId && right === rightBranchId)) {
    return {
      kind: 'directed',
      sourceOccurrenceRef: participantRefs[0],
      targetOccurrenceRef: participantRefs[1],
    };
  }
  if (rows.some(([left, right]) => left === rightBranchId && right === leftBranchId)) {
    return {
      kind: 'directed',
      sourceOccurrenceRef: participantRefs[1],
      targetOccurrenceRef: participantRefs[0],
    };
  }
  return null;
}

function pairLayers(coordinate, profile) {
  const stems = [];
  const branches = [];
  for (let pairIndex = 0; pairIndex < pillarPairRows.length; pairIndex += 1) {
    const pair = pillarPairRows[pairIndex];
    const leftOccurrenceIndex = PILLAR_PAIR_SLOT_INDEX_TABLE_12[pairIndex * 2];
    const rightOccurrenceIndex = PILLAR_PAIR_SLOT_INDEX_TABLE_12[(pairIndex * 2) + 1];
    const leftStemCode = coordinate.stemCodes4[leftOccurrenceIndex];
    const rightStemCode = coordinate.stemCodes4[rightOccurrenceIndex];
    const leftBranchCode = coordinate.branchCodes4[leftOccurrenceIndex];
    const rightBranchCode = coordinate.branchCodes4[rightOccurrenceIndex];
    const stemCombinationCode = STEM_COMBINATION_CODE_TABLE_100[(leftStemCode * 10) + rightStemCode];
    const relationMask1 = stemCombinationCode & 1;
    const traditionalCorrespondenceElementCode = relationMask1 === 1
      ? (stemCombinationCode >>> 1) - 1
      : null;
    const relationMask5 = BRANCH_PAIR_RELATION_MASK_TABLE_144[(leftBranchCode * 12) + rightBranchCode];

    stems.push({
      pairId: pair.id,
      pairCode: pair.code,
      participantRefs: [visibleStemOccurrenceRef(pair.leftSlot), visibleStemOccurrenceRef(pair.rightSlot)],
      leftOccurrenceIndex,
      rightOccurrenceIndex,
      leftStemId: STEM_IDS[leftStemCode],
      leftStemCode,
      rightStemId: STEM_IDS[rightStemCode],
      rightStemCode,
      ...elementRelationFields(STEM_ELEMENT_CODES[leftStemCode], STEM_ELEMENT_CODES[rightStemCode]),
      relationMask1,
      combinationCandidate: relationMask1 === 1,
      traditionalCorrespondenceElementId: traditionalCorrespondenceElementCode == null
        ? null
        : ELEMENT_IDS[traditionalCorrespondenceElementCode],
      traditionalCorrespondenceElementCode,
    });

    const branchParticipantRefs = [
      branchOccurrenceRef(pair.leftSlot), branchOccurrenceRef(pair.rightSlot),
    ];
    branches.push({
      pairId: pair.id,
      pairCode: pair.code,
      participantRefs: branchParticipantRefs,
      leftOccurrenceIndex,
      rightOccurrenceIndex,
      leftBranchId: BRANCH_IDS[leftBranchCode],
      leftBranchCode,
      rightBranchId: BRANCH_IDS[rightBranchCode],
      rightBranchCode,
      ...elementRelationFields(BRANCH_ELEMENT_CODES[leftBranchCode], BRANCH_ELEMENT_CODES[rightBranchCode]),
      relationMask5,
      relationIds: branchRelationIds(relationMask5),
      punishmentDirection: (relationMask5 & branchFlagById.get('punishment')) !== 0
        ? punishmentDirection(
          profile,
          BRANCH_IDS[leftBranchCode],
          BRANCH_IDS[rightBranchCode],
          branchParticipantRefs,
        )
        : null,
    });
  }
  return { stems, branches };
}

function slotIndexesInMask(slotMask4) {
  const result = [];
  for (let slotIndex = 0; slotIndex < PILLAR_SLOTS.length; slotIndex += 1) {
    if ((slotMask4 & (1 << slotIndex)) !== 0) result.push(slotIndex);
  }
  return result;
}

function occurrenceHyperedges(coordinate, completeGroupMask10) {
  const hyperedges = [];
  for (let groupIndex = 0; groupIndex < hyperedgeGroupRows.length; groupIndex += 1) {
    if ((completeGroupMask10 & (1 << groupIndex)) === 0) continue;
    const group = hyperedgeGroupRows[groupIndex];
    const memberBranchCodes = group.memberBranchIds.map((branchId) => branchIndexOf(branchId));
    const participantOptions = memberBranchCodes.map(
      (branchCode) => slotIndexesInMask(coordinate.branchSlotMasks4ByCode12[branchCode]),
    );

    for (const firstSlotIndex of participantOptions[0]) {
      for (const secondSlotIndex of participantOptions[1]) {
        for (const thirdSlotIndex of participantOptions[2]) {
          const participantSlotIndexes = [firstSlotIndex, secondSlotIndex, thirdSlotIndex];
          hyperedges.push({
            hyperedgeIndex: hyperedges.length,
            groupId: group.id,
            groupCode: group.code,
            relationId: group.relationId,
            completeOnly: true,
            memberBranchIds: group.memberBranchIds,
            memberBranchCodes,
            participantRefs: participantSlotIndexes.map(
              (slotIndex) => branchOccurrenceRef(PILLAR_SLOTS[slotIndex]),
            ),
            participantSlotIndexes,
            participantSlotMask4: participantSlotIndexes.reduce(
              (mask, slotIndex) => mask | (1 << slotIndex),
              0,
            ),
          });
        }
      }
    }
  }
  return hyperedges;
}

// Internal numeric fast path for exhaustive audits. It trusts a coordinate
// returned by buildValidatedPillarCoordinate and creates no relation graph.
export function deriveBaziRelationSignatureFromCoordinate(coordinate) {
  return scanCompactRelations(coordinate);
}

// Internal material fast path. Public callers must use deriveBaziRelationMaterials.
export function deriveBaziRelationMaterialsFromCoordinate(coordinate, relationProfile = BAZI_RELATION_PROFILE) {
  if (relationProfile?.id !== BAZI_RELATION_PROFILE_ID) {
    throw new RangeError(`unsupported RelationProfile: ${String(relationProfile?.id)}`);
  }
  assertRelationFoundationBinding(relationProfile, BAZI_STRUCTURAL_CODEBOOK_VERSION);
  const accelerators = scanCompactRelations(coordinate);
  return deepFreeze({
    version: BAZI_RELATION_MATERIALS_VERSION,
    codebookVersion: BAZI_RELATION_CODEBOOK_VERSION,
    profileId: relationProfile.id,
    policy: relationProfile.policy,
    occurrences: occurrenceLayers(coordinate),
    pairs: pairLayers(coordinate, relationProfile),
    hyperedges: occurrenceHyperedges(coordinate, accelerators.completeGroupMask10),
    accelerators,
  });
}

export function deriveBaziRelationMaterials(pillars) {
  const captured = captureValidatedPillars(pillars);
  return deriveBaziRelationMaterialsFromCoordinate(
    buildValidatedPillarCoordinate(captured),
    BAZI_RELATION_PROFILE,
  );
}
