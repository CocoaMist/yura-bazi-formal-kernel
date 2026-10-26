import {
  BRANCH_IDS,
  branchIndexOf,
  PILLAR_SLOTS,
  SEXAGENARY_PILLARS,
  sexagenaryIndexOf,
  STEM_IDS,
  stemIndexOf,
} from './constants.mjs';
import { captureExactDataRecord } from '../shared/assert.mjs';
import { domainHashV1 } from '../shared/canonical.mjs';

export const DIRECT_PILLAR_ENCODING_VERSION = 'bazi.pillar_code24.v1';
export const GRAMMAR_STATE_INDEX_VERSION = 'bazi.grammar_state_index19.v1';
export const GRAMMAR_STATE_COUNT = 518_400;
export const CANONICAL_CHART_COORDINATE_VERSION = 'bazi.canonical_chart_coordinate.v2';

const SEXAGENARY_COUNT = SEXAGENARY_PILLARS.length;
const BRANCH_COUNT = BRANCH_IDS.length;
const STATES_PER_DAY = BRANCH_COUNT;
const STATES_PER_MONTH_BRANCH = SEXAGENARY_COUNT * STATES_PER_DAY;
const STATES_PER_YEAR = BRANCH_COUNT * STATES_PER_MONTH_BRANCH;

function freezeNumberArray(values) {
  return Object.freeze(values);
}

export function sexagenaryIndex(pillar) {
  const captured = captureExactDataRecord(pillar, ['stemId', 'branchId'], 'pillar');
  const index = sexagenaryIndexOf(captured.stemId, captured.branchId);
  if (index == null) {
    throw new RangeError(`invalid sexagenary pillar: ${captured.stemId}:${captured.branchId}`);
  }
  return index;
}

export function pillarFromSexagenaryIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 60) {
    throw new RangeError('sexagenary index must be an integer in [0, 59]');
  }
  const pillar = SEXAGENARY_PILLARS[index];
  return Object.freeze({ stemId: pillar.stemId, branchId: pillar.branchId });
}

export function expectedMonthStemId(yearStemId, monthBranchId) {
  const yearStem = stemIndexOf(yearStemId);
  const monthBranch = branchIndexOf(monthBranchId);
  if (yearStem == null) throw new RangeError(`unknown year stem: ${yearStemId}`);
  if (monthBranch == null) throw new RangeError(`unknown month branch: ${monthBranchId}`);
  const yinMonthStart = ((yearStem % 5) * 2 + 2) % 10;
  const monthOffset = (monthBranch - 2 + 12) % 12;
  return STEM_IDS[(yinMonthStart + monthOffset) % 10];
}

export function expectedHourStemId(dayStemId, hourBranchId) {
  const dayStem = stemIndexOf(dayStemId);
  const hourBranch = branchIndexOf(hourBranchId);
  if (dayStem == null) throw new RangeError(`unknown day stem: ${dayStemId}`);
  if (hourBranch == null) throw new RangeError(`unknown hour branch: ${hourBranchId}`);
  const ziHourStart = (dayStem % 5) * 2;
  return STEM_IDS[(ziHourStart + hourBranch) % 10];
}

function assertCapturedPillarGrammar(pillars) {
  for (const slot of PILLAR_SLOTS) {
    const pillar = pillars[slot];
    const index = sexagenaryIndexOf(pillar.stemId, pillar.branchId);
    if (index == null) {
      throw new RangeError(`invalid sexagenary pillar: ${pillar.stemId}:${pillar.branchId}`);
    }
  }
  const expectedMonth = expectedMonthStemId(pillars.year.stemId, pillars.month.branchId);
  if (pillars.month.stemId !== expectedMonth) {
    throw new RangeError(`month stem mismatch: expected ${expectedMonth}, received ${pillars.month.stemId}`);
  }
  const expectedHour = expectedHourStemId(pillars.day.stemId, pillars.hour.branchId);
  if (pillars.hour.stemId !== expectedHour) {
    throw new RangeError(`hour stem mismatch: expected ${expectedHour}, received ${pillars.hour.stemId}`);
  }
  return true;
}

// Internal authoritative capture boundary. Every permitted field is copied
// once from own data descriptors into deeply frozen plain records before any
// grammar check or numeric derivation. It is intentionally not root-exported.
export function captureValidatedPillars(pillars) {
  const source = captureExactDataRecord(pillars, PILLAR_SLOTS, 'pillars');
  const captured = Object.freeze(Object.fromEntries(PILLAR_SLOTS.map((slot) => {
    const pillar = captureExactDataRecord(
      source[slot],
      ['stemId', 'branchId'],
      `pillars.${slot}`,
    );
    return [slot, Object.freeze({
      stemId: pillar.stemId,
      branchId: pillar.branchId,
    })];
  })));
  assertCapturedPillarGrammar(captured);
  return captured;
}

export function assertPillarGrammar(pillars) {
  captureValidatedPillars(pillars);
  return true;
}

// Internal numeric coordinate for already validated pillars. This deliberately
// does not repeat record, exact-key or grammar validation; public entry points
// validate first and this module-level export is not re-exported by src/index.
export function buildValidatedPillarCoordinate(pillars) {
  const stemCodes4 = new Array(PILLAR_SLOTS.length);
  const branchCodes4 = new Array(PILLAR_SLOTS.length);
  const sexagenaryCodes4 = new Array(PILLAR_SLOTS.length);
  const stemSlotMasks4ByCode10 = new Array(STEM_IDS.length).fill(0);
  const branchSlotMasks4ByCode12 = new Array(BRANCH_IDS.length).fill(0);
  let pillarCode24 = 0;
  let visibleStemPresenceMask10 = 0;
  let branchPresenceMask12 = 0;

  for (let slotIndex = 0; slotIndex < PILLAR_SLOTS.length; slotIndex += 1) {
    const pillar = pillars[PILLAR_SLOTS[slotIndex]];
    const stemCode = stemIndexOf(pillar.stemId);
    const branchCode = branchIndexOf(pillar.branchId);
    const sexagenaryCode = sexagenaryIndexOf(pillar.stemId, pillar.branchId);
    const slotMask4 = 1 << slotIndex;

    stemCodes4[slotIndex] = stemCode;
    branchCodes4[slotIndex] = branchCode;
    sexagenaryCodes4[slotIndex] = sexagenaryCode;
    pillarCode24 |= sexagenaryCode << (slotIndex * 6);
    visibleStemPresenceMask10 |= 1 << stemCode;
    branchPresenceMask12 |= 1 << branchCode;
    stemSlotMasks4ByCode10[stemCode] |= slotMask4;
    branchSlotMasks4ByCode12[branchCode] |= slotMask4;
  }

  const index19 = (sexagenaryCodes4[0] * STATES_PER_YEAR)
    + (branchCodes4[1] * STATES_PER_MONTH_BRANCH)
    + (sexagenaryCodes4[2] * STATES_PER_DAY)
    + branchCodes4[3];

  const coordinateHash = domainHashV1('bazi.coordinate.v2', {
    version: CANONICAL_CHART_COORDINATE_VERSION,
    pillars: Object.fromEntries(PILLAR_SLOTS.map((slot) => [slot, pillars[slot]])),
  });
  return Object.freeze({
    version: CANONICAL_CHART_COORDINATE_VERSION,
    coordinateHash,
    pillarCode24: pillarCode24 >>> 0,
    index19,
    stemCodes4: freezeNumberArray(stemCodes4),
    branchCodes4: freezeNumberArray(branchCodes4),
    sexagenaryCodes4: freezeNumberArray(sexagenaryCodes4),
    visibleStemPresenceMask10,
    branchPresenceMask12,
    stemSlotMasks4ByCode10: freezeNumberArray(stemSlotMasks4ByCode10),
    branchSlotMasks4ByCode12: freezeNumberArray(branchSlotMasks4ByCode12),
  });
}

export function packFourPillars24(pillars) {
  return buildValidatedPillarCoordinate(captureValidatedPillars(pillars)).pillarCode24;
}

export function unpackFourPillars24(code) {
  if (!Number.isInteger(code) || code < 0 || code > 0x00ff_ffff) {
    throw new RangeError('pillar code must be an unsigned 24-bit integer');
  }
  const pillars = {};
  for (let slotIndex = 0; slotIndex < PILLAR_SLOTS.length; slotIndex += 1) {
    const index = (code >>> (slotIndex * 6)) & 0b11_1111;
    if (index >= 60) throw new RangeError(`pillar code contains reserved index ${index}`);
    pillars[PILLAR_SLOTS[slotIndex]] = pillarFromSexagenaryIndex(index);
  }
  assertCapturedPillarGrammar(pillars);
  return Object.freeze(pillars);
}

export function rankGrammarState19(pillars) {
  return buildValidatedPillarCoordinate(captureValidatedPillars(pillars)).index19;
}

export function unrankGrammarState19(index) {
  if (!Number.isInteger(index) || index < 0 || index >= GRAMMAR_STATE_COUNT) {
    throw new RangeError(`grammar state index must be an integer in [0, ${GRAMMAR_STATE_COUNT - 1}]`);
  }

  let remainder = index;
  const yearIndex = Math.floor(remainder / STATES_PER_YEAR);
  remainder %= STATES_PER_YEAR;
  const monthBranchIndex = Math.floor(remainder / STATES_PER_MONTH_BRANCH);
  remainder %= STATES_PER_MONTH_BRANCH;
  const dayIndex = Math.floor(remainder / STATES_PER_DAY);
  const hourBranchIndex = remainder % STATES_PER_DAY;

  const year = pillarFromSexagenaryIndex(yearIndex);
  const monthBranchId = BRANCH_IDS[monthBranchIndex];
  const day = pillarFromSexagenaryIndex(dayIndex);
  const hourBranchId = BRANCH_IDS[hourBranchIndex];
  return Object.freeze({
    year,
    month: Object.freeze({
      stemId: expectedMonthStemId(year.stemId, monthBranchId),
      branchId: monthBranchId,
    }),
    day,
    hour: Object.freeze({
      stemId: expectedHourStemId(day.stemId, hourBranchId),
      branchId: hourBranchId,
    }),
  });
}
