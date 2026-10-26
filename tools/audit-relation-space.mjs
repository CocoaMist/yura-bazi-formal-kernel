import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  GRAMMAR_STATE_COUNT,
  buildValidatedPillarCoordinate,
  unrankGrammarState19,
} from '../src/bazi/encoding.mjs';
import { deriveBaziRelationSignatureFromCoordinate } from '../src/bazi/relations.mjs';

const candidateManifestHash = JSON.parse(readFileSync(
  new URL('../release-manifest.json', import.meta.url),
  'utf8',
)).releaseCandidate.candidateManifestHash;

// Independent numeric oracles. These literals deliberately do not import the
// relation profile or any runtime lookup table.
const STEM_ELEMENT_CODES10 = Object.freeze([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
const BRANCH_ELEMENT_CODES12 = Object.freeze([4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4]);
const STEM_COMBINATION_PARTNER10 = Object.freeze([5, 6, 7, 8, 9, 0, 1, 2, 3, 4]);
const ELEMENT_RELATION_BY_CYCLE_DISTANCE5 = Object.freeze([0, 1, 3, 4, 2]);
const PILLAR_PAIR_SLOT_INDEXES12 = Object.freeze([
  0, 1,
  0, 2,
  0, 3,
  1, 2,
  1, 3,
  2, 3,
]);

// Bit order: 六合=1, 冲=2, 刑=4, 害=8, 破=16.
const BRANCH_RELATION_MASKS12X12 = Object.freeze([
  Object.freeze([0, 1, 0, 4, 0, 0, 2, 8, 0, 16, 0, 0]),
  Object.freeze([1, 0, 0, 0, 16, 0, 8, 6, 0, 0, 4, 0]),
  Object.freeze([0, 0, 0, 0, 0, 12, 0, 0, 6, 0, 0, 17]),
  Object.freeze([4, 0, 0, 0, 8, 0, 16, 0, 0, 2, 1, 0]),
  Object.freeze([0, 16, 0, 8, 4, 0, 0, 0, 0, 1, 2, 0]),
  Object.freeze([0, 0, 12, 0, 0, 0, 0, 0, 21, 0, 0, 2]),
  Object.freeze([2, 8, 0, 16, 0, 0, 4, 1, 0, 0, 0, 0]),
  Object.freeze([8, 6, 0, 0, 0, 0, 1, 0, 0, 0, 20, 0]),
  Object.freeze([0, 0, 6, 0, 0, 21, 0, 0, 0, 0, 0, 8]),
  Object.freeze([16, 0, 0, 2, 1, 0, 0, 0, 0, 4, 8, 0]),
  Object.freeze([0, 4, 0, 1, 2, 0, 0, 20, 0, 8, 0, 0]),
  Object.freeze([0, 0, 17, 0, 0, 2, 0, 0, 8, 0, 0, 4]),
]);

// Code order is an explicit release contract:
// 三合水木火金、三会水木火金、寅巳申刑组、丑戌未刑组。
const COMPLETE_GROUP_REQUIRED_MASKS10 = Object.freeze([
  0x111, 0x888, 0x444, 0x222,
  0x803, 0x01c, 0x0e0, 0x700,
  0x124, 0x482,
]);

const SIGNATURE_FIELDS = Object.freeze([
  'visibleStemPresenceMask10',
  'branchPresenceMask12',
  'stemCombinationPairMask6',
  'branchPairRelationMasks30',
  'stemElementRelationCodes18',
  'branchElementRelationCodes18',
  'completeGroupMask10',
]);

function elementRelationCode(fromElementCode, toElementCode) {
  const distance = (toElementCode - fromElementCode + 5) % 5;
  return ELEMENT_RELATION_BY_CYCLE_DISTANCE5[distance];
}

function oracleSignature(coordinate) {
  let visibleStemPresenceMask10 = 0;
  let branchPresenceMask12 = 0;
  for (let slotIndex = 0; slotIndex < 4; slotIndex += 1) {
    visibleStemPresenceMask10 |= 1 << coordinate.stemCodes4[slotIndex];
    branchPresenceMask12 |= 1 << coordinate.branchCodes4[slotIndex];
  }

  let stemCombinationPairMask6 = 0;
  let branchPairRelationMasks30 = 0;
  let stemElementRelationCodes18 = 0;
  let branchElementRelationCodes18 = 0;
  for (let pairIndex = 0; pairIndex < 6; pairIndex += 1) {
    const leftSlotIndex = PILLAR_PAIR_SLOT_INDEXES12[pairIndex * 2];
    const rightSlotIndex = PILLAR_PAIR_SLOT_INDEXES12[(pairIndex * 2) + 1];
    const leftStemCode = coordinate.stemCodes4[leftSlotIndex];
    const rightStemCode = coordinate.stemCodes4[rightSlotIndex];
    const leftBranchCode = coordinate.branchCodes4[leftSlotIndex];
    const rightBranchCode = coordinate.branchCodes4[rightSlotIndex];
    if (STEM_COMBINATION_PARTNER10[leftStemCode] === rightStemCode) {
      stemCombinationPairMask6 |= 1 << pairIndex;
    }
    branchPairRelationMasks30 |= (
      BRANCH_RELATION_MASKS12X12[leftBranchCode][rightBranchCode] << (pairIndex * 5)
    );
    stemElementRelationCodes18 |= elementRelationCode(
      STEM_ELEMENT_CODES10[leftStemCode],
      STEM_ELEMENT_CODES10[rightStemCode],
    ) << (pairIndex * 3);
    branchElementRelationCodes18 |= elementRelationCode(
      BRANCH_ELEMENT_CODES12[leftBranchCode],
      BRANCH_ELEMENT_CODES12[rightBranchCode],
    ) << (pairIndex * 3);
  }

  let completeGroupMask10 = 0;
  for (let groupCode = 0; groupCode < COMPLETE_GROUP_REQUIRED_MASKS10.length; groupCode += 1) {
    const requiredMask12 = COMPLETE_GROUP_REQUIRED_MASKS10[groupCode];
    if ((branchPresenceMask12 & requiredMask12) === requiredMask12) {
      completeGroupMask10 |= 1 << groupCode;
    }
  }

  return {
    visibleStemPresenceMask10,
    branchPresenceMask12,
    stemCombinationPairMask6,
    branchPairRelationMasks30: branchPairRelationMasks30 >>> 0,
    stemElementRelationCodes18,
    branchElementRelationCodes18,
    completeGroupMask10,
  };
}

// The 32-bit value is only a human-readable display digest. Formal release
// verification uses the full SHA-256 over the same little-endian word stream.
let checksum32 = 0x811c9dc5;
const digest = createHash('sha256');
const WORDS_PER_FLUSH = 1 << 16;
const digestWords = new Uint32Array(WORDS_PER_FLUSH);
const digestBytes = Buffer.from(digestWords.buffer);
let pendingWords = 0;

function flushDigest() {
  if (pendingWords === 0) return;
  digest.update(digestBytes.subarray(0, pendingWords * 4));
  pendingWords = 0;
}

function checksumUint32(value) {
  let remaining = value >>> 0;
  for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
    checksum32 ^= remaining & 0xff;
    checksum32 = Math.imul(checksum32, 0x01000193) >>> 0;
    remaining >>>= 8;
  }
  digestWords[pendingWords] = value >>> 0;
  pendingWords += 1;
  if (pendingWords === WORDS_PER_FLUSH) flushDigest();
}

const startedAt = performance.now();
for (let index19 = 0; index19 < GRAMMAR_STATE_COUNT; index19 += 1) {
  const pillars = unrankGrammarState19(index19);
  const coordinate = buildValidatedPillarCoordinate(pillars);
  if (coordinate.index19 !== index19) {
    throw new Error(`coordinate index mismatch at ${index19}: ${coordinate.index19}`);
  }
  const actual = deriveBaziRelationSignatureFromCoordinate(coordinate);
  const expected = oracleSignature(coordinate);
  for (const field of SIGNATURE_FIELDS) {
    if (actual[field] !== expected[field]) {
      throw new Error(
        `relation oracle mismatch at ${index19}.${field}: expected ${expected[field]}, received ${actual[field]}`,
      );
    }
  }
  checksumUint32(index19);
  for (const field of SIGNATURE_FIELDS) checksumUint32(actual[field]);
}

flushDigest();
const elapsedMs = performance.now() - startedAt;
console.log(JSON.stringify({
  report: 'relation_space_audit',
  auditedStates: GRAMMAR_STATE_COUNT,
  expectedStates: GRAMMAR_STATE_COUNT,
  candidateManifestHash,
  auditDigest: `sha256:${digest.digest('hex')}`,
  displayDigest: checksum32.toString(16).padStart(8, '0'),
  elapsedMs: Number(elapsedMs.toFixed(1)),
}, null, 2));
