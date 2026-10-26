import { PILLAR_SLOTS } from './constants.mjs';
import {
  buildValidatedPillarCoordinate,
  captureValidatedPillars,
} from './encoding.mjs';
import {
  BAZI_STRUCTURAL_CODEBOOK,
  BAZI_STRUCTURAL_CODEBOOK_VERSION,
  BAZI_STRUCTURAL_PROFILE,
  BAZI_STRUCTURAL_PROFILE_ID,
  GROWTH_STAGE_PROFILE,
  GROWTH_STAGE_PROFILE_ID,
  HIDDEN_STEM_PROFILE,
  HIDDEN_STEM_PROFILE_ID,
} from './foundation-profile.mjs';

export const BAZI_STRUCTURAL_CODES_VERSION = 'bazi.structural_codes.v1';

const domains = BAZI_STRUCTURAL_CODEBOOK.domains;
const rowsByDomainAndId = Object.freeze(Object.fromEntries(
  Object.entries(domains).map(([domainId, domain]) => [
    domainId,
    new Map(domain.values.map((row) => [row.id, row])),
  ]),
));

function rowsByCode(domainId) {
  const rows = new Array(domains[domainId].valueCount);
  for (const row of domains[domainId].values) rows[row.code] = row;
  return Object.freeze(rows);
}

const ELEMENT_ROWS_BY_CODE = rowsByCode('elements');
const POLARITY_ROWS_BY_CODE = rowsByCode('polarities');
const ELEMENT_RELATION_ROWS_BY_CODE = rowsByCode('elementRelations');
const TEN_GOD_ROWS_BY_CODE = rowsByCode('tenGods');
const STEM_ROWS_BY_CODE = rowsByCode('stems');
const BRANCH_ROWS_BY_CODE = rowsByCode('branches');
const GROWTH_STAGE_ROWS_BY_CODE = rowsByCode('growthStages');

function rowOf(domainId, id, field) {
  const row = rowsByDomainAndId[domainId].get(id);
  if (!row) throw new RangeError(`unknown ${field}: ${String(id)}`);
  return row;
}

function elementRowOf(elementId, field = 'element') {
  return rowOf('elements', elementId, field);
}

function stemRowOf(stemId, field = 'stem') {
  return rowOf('stems', stemId, field);
}

function branchRowOf(branchId, field = 'branch') {
  return rowOf('branches', branchId, field);
}

const STEM_ELEMENT_CODES10 = Uint8Array.from(
  STEM_ROWS_BY_CODE,
  (stem) => elementRowOf(stem.elementId).code,
);
const STEM_POLARITY_CODES10 = Uint8Array.from(
  STEM_ROWS_BY_CODE,
  (stem) => rowOf('polarities', stem.polarityId, 'polarity').code,
);
const BRANCH_ELEMENT_CODES12 = Uint8Array.from(
  BRANCH_ROWS_BY_CODE,
  (branch) => elementRowOf(branch.nominalElementId, 'branch nominal element').code,
);
const BRANCH_POLARITY_CODES12 = Uint8Array.from(
  BRANCH_ROWS_BY_CODE,
  (branch) => rowOf('polarities', branch.polarityId, 'branch polarity').code,
);

// Element codes follow the generating cycle. Cycle distance maps to the stable
// relation codes: same, generates, controls, controlled_by, generated_by.
const RELATION_CODE_BY_CYCLE_DISTANCE5 = Uint8Array.of(0, 1, 3, 4, 2);
const ELEMENT_RELATION_CODES25 = new Uint8Array(25);
for (let fromCode = 0; fromCode < 5; fromCode += 1) {
  for (let toCode = 0; toCode < 5; toCode += 1) {
    const distance = (toCode - fromCode + 5) % 5;
    ELEMENT_RELATION_CODES25[(fromCode * 5) + toCode] = RELATION_CODE_BY_CYCLE_DISTANCE5[distance];
  }
}

const SAME_POLARITY_TEN_GOD_BY_RELATION5 = Uint8Array.of(0, 2, 8, 4, 6);
const OTHER_POLARITY_TEN_GOD_BY_RELATION5 = Uint8Array.of(1, 3, 9, 5, 7);
const TEN_GOD_CODES100 = new Uint8Array(100);
for (let dayStemCode = 0; dayStemCode < 10; dayStemCode += 1) {
  for (let targetStemCode = 0; targetStemCode < 10; targetStemCode += 1) {
    const relationCode = ELEMENT_RELATION_CODES25[
      (STEM_ELEMENT_CODES10[dayStemCode] * 5) + STEM_ELEMENT_CODES10[targetStemCode]
    ];
    const samePolarity = STEM_POLARITY_CODES10[dayStemCode] === STEM_POLARITY_CODES10[targetStemCode];
    TEN_GOD_CODES100[(dayStemCode * 10) + targetStemCode] = (samePolarity
      ? SAME_POLARITY_TEN_GOD_BY_RELATION5
      : OTHER_POLARITY_TEN_GOD_BY_RELATION5)[relationCode];
  }
}

const GROWTH_STAGE_CODES120 = new Uint8Array(120);
for (let dayStemCode = 0; dayStemCode < 10; dayStemCode += 1) {
  const dayStem = STEM_ROWS_BY_CODE[dayStemCode];
  const startBranchCode = branchRowOf(
    GROWTH_STAGE_PROFILE.birthStartBranchByStem[dayStem.id],
    'growth-stage start branch',
  ).code;
  const direction = STEM_POLARITY_CODES10[dayStemCode] === 0 ? 1 : -1;
  for (let branchCode = 0; branchCode < 12; branchCode += 1) {
    GROWTH_STAGE_CODES120[(dayStemCode * 12) + branchCode] = (
      (direction * (branchCode - startBranchCode)) % 12 + 12
    ) % 12;
  }
}

const HIDDEN_STEM_COUNTS12 = new Uint8Array(12);
const HIDDEN_STEM_CODES36 = new Uint8Array(36);
HIDDEN_STEM_CODES36.fill(0xff);
for (let branchCode = 0; branchCode < 12; branchCode += 1) {
  const branchId = BRANCH_ROWS_BY_CODE[branchCode].id;
  const hiddenStemIds = HIDDEN_STEM_PROFILE.branches[branchId];
  HIDDEN_STEM_COUNTS12[branchCode] = hiddenStemIds.length;
  for (let orderIndex = 0; orderIndex < hiddenStemIds.length; orderIndex += 1) {
    HIDDEN_STEM_CODES36[(branchCode * 3) + orderIndex] = stemRowOf(
      hiddenStemIds[orderIndex],
      'hidden stem',
    ).code;
  }
}

function relationCodeFromElementCodes(fromElementCode, toElementCode) {
  return ELEMENT_RELATION_CODES25[(fromElementCode * 5) + toElementCode];
}

function tenGodCodeFromStemCodes(dayStemCode, targetStemCode) {
  return TEN_GOD_CODES100[(dayStemCode * 10) + targetStemCode];
}

function stemMaterialFromCode(stemCode) {
  const stem = STEM_ROWS_BY_CODE[stemCode];
  const elementCode = STEM_ELEMENT_CODES10[stemCode];
  const polarityCode = STEM_POLARITY_CODES10[stemCode];
  return Object.freeze({
    stemId: stem.id,
    stemCode,
    elementId: ELEMENT_ROWS_BY_CODE[elementCode].id,
    elementCode,
    polarityId: POLARITY_ROWS_BY_CODE[polarityCode].id,
    polarityCode,
  });
}

function branchMaterialFromCode(branchCode) {
  const branch = BRANCH_ROWS_BY_CODE[branchCode];
  const nominalElementCode = BRANCH_ELEMENT_CODES12[branchCode];
  const polarityCode = BRANCH_POLARITY_CODES12[branchCode];
  return Object.freeze({
    branchId: branch.id,
    branchCode,
    nominalElementId: ELEMENT_ROWS_BY_CODE[nominalElementCode].id,
    nominalElementCode,
    polarityId: POLARITY_ROWS_BY_CODE[polarityCode].id,
    polarityCode,
  });
}

function relationMaterialFromStemCodes(dayStemCode, targetStemCode) {
  const elementRelationCode = relationCodeFromElementCodes(
    STEM_ELEMENT_CODES10[dayStemCode],
    STEM_ELEMENT_CODES10[targetStemCode],
  );
  const tenGodCode = tenGodCodeFromStemCodes(dayStemCode, targetStemCode);
  return Object.freeze({
    elementRelationId: ELEMENT_RELATION_ROWS_BY_CODE[elementRelationCode].id,
    elementRelationCode,
    tenGodId: TEN_GOD_ROWS_BY_CODE[tenGodCode].id,
    tenGodCode,
  });
}

function growthStageCodeFromCodes(dayStemCode, branchCode) {
  return GROWTH_STAGE_CODES120[(dayStemCode * 12) + branchCode];
}

export function elementRelationCodeOf(fromElementId, toElementId) {
  const fromElementCode = elementRowOf(fromElementId, 'source element').code;
  const toElementCode = elementRowOf(toElementId, 'target element').code;
  return relationCodeFromElementCodes(fromElementCode, toElementCode);
}

export function tenGodCodeOf(dayStemId, targetStemId) {
  const dayStemCode = stemRowOf(dayStemId, 'day stem').code;
  const targetStemCode = stemRowOf(targetStemId, 'target stem').code;
  return tenGodCodeFromStemCodes(dayStemCode, targetStemCode);
}

export function branchElementCodeOf(branchId) {
  return BRANCH_ELEMENT_CODES12[branchRowOf(branchId, 'branch').code];
}

export function hiddenStemCodesOf(branchId) {
  const branchCode = branchRowOf(branchId, 'branch').code;
  const hiddenStemCount = HIDDEN_STEM_COUNTS12[branchCode];
  return Object.freeze(Array.from({ length: hiddenStemCount }, (_, orderIndex) => {
    const stemCode = HIDDEN_STEM_CODES36[(branchCode * 3) + orderIndex];
    return Object.freeze({
      orderIndex,
      stemId: STEM_ROWS_BY_CODE[stemCode].id,
      stemCode,
    });
  }));
}

export function growthStageCodeOf(dayStemId, branchId, profileId = GROWTH_STAGE_PROFILE_ID) {
  const dayStemCode = stemRowOf(dayStemId, 'day stem').code;
  const branchCode = branchRowOf(branchId, 'target branch').code;
  if (profileId !== GROWTH_STAGE_PROFILE_ID) {
    throw new RangeError(`unknown growth-stage profile: ${String(profileId)}`);
  }
  return growthStageCodeFromCodes(dayStemCode, branchCode);
}

// Internal fast path for a coordinate produced from already validated pillars.
// It intentionally trusts the coordinate and is not re-exported by src/index.
export function deriveBaziStructuralCodesFromCoordinate(coordinate) {
  const dayStemCode = coordinate.stemCodes4[2];
  const derivedPillars = Object.freeze(Object.fromEntries(PILLAR_SLOTS.map((slot, slotIndex) => {
    const stemCode = coordinate.stemCodes4[slotIndex];
    const branchCode = coordinate.branchCodes4[slotIndex];
    const growthStageCode = growthStageCodeFromCodes(dayStemCode, branchCode);
    const hiddenStemCount = HIDDEN_STEM_COUNTS12[branchCode];
    const hiddenStems = Object.freeze(Array.from({ length: hiddenStemCount }, (_, orderIndex) => {
      const hiddenStemCode = HIDDEN_STEM_CODES36[(branchCode * 3) + orderIndex];
      return Object.freeze({
        orderIndex,
        stem: stemMaterialFromCode(hiddenStemCode),
        fromDayMaster: relationMaterialFromStemCodes(dayStemCode, hiddenStemCode),
      });
    }));
    return [slot, Object.freeze({
      slot,
      branch: branchMaterialFromCode(branchCode),
      stem: stemMaterialFromCode(stemCode),
      fromDayMaster: relationMaterialFromStemCodes(dayStemCode, stemCode),
      hiddenStems,
      growthStage: Object.freeze({
        profileId: GROWTH_STAGE_PROFILE_ID,
        stageId: GROWTH_STAGE_ROWS_BY_CODE[growthStageCode].id,
        stageCode: growthStageCode,
      }),
    })];
  })));

  return Object.freeze({
    version: BAZI_STRUCTURAL_CODES_VERSION,
    codebookVersion: BAZI_STRUCTURAL_CODEBOOK_VERSION,
    structuralProfileId: BAZI_STRUCTURAL_PROFILE_ID,
    hiddenStemProfileId: HIDDEN_STEM_PROFILE_ID,
    growthStageProfileId: GROWTH_STAGE_PROFILE_ID,
    policy: BAZI_STRUCTURAL_PROFILE.policy,
    dayMaster: stemMaterialFromCode(dayStemCode),
    pillars: derivedPillars,
  });
}

export function deriveBaziStructuralCodes(pillars) {
  const captured = captureValidatedPillars(pillars);
  return deriveBaziStructuralCodesFromCoordinate(buildValidatedPillarCoordinate(captured));
}
