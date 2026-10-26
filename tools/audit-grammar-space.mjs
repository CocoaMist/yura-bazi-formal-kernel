import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  BRANCH_IDS,
  expectedHourStemId,
  expectedMonthStemId,
  GRAMMAR_STATE_COUNT,
  packFourPillars24,
  pillarFromSexagenaryIndex,
  rankGrammarState19,
  unrankGrammarState19,
  unpackFourPillars24,
} from '../src/index.mjs';

const SEXAGENARY_COUNT = 60;
const EXPECTED_GRAMMAR_STATES = SEXAGENARY_COUNT * BRANCH_IDS.length
  * SEXAGENARY_COUNT * BRANCH_IDS.length;
const pillarSlots = ['year', 'month', 'day', 'hour'];
const pillarsByIndex = Array.from(
  { length: SEXAGENARY_COUNT },
  (_, index) => pillarFromSexagenaryIndex(index),
);
const candidateManifestHash = JSON.parse(readFileSync(
  new URL('../release-manifest.json', import.meta.url),
  'utf8',
)).releaseCandidate.candidateManifestHash;

// Formal release verification uses the full SHA-256 over the ordered
// rank19/code24 pair stream, not a short display value.
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

function digestUint32(value) {
  digestWords[pendingWords] = value >>> 0;
  pendingWords += 1;
  if (pendingWords === WORDS_PER_FLUSH) flushDigest();
}

let checked = 0;
for (const year of pillarsByIndex) {
  for (const monthBranchId of BRANCH_IDS) {
    const month = {
      stemId: expectedMonthStemId(year.stemId, monthBranchId),
      branchId: monthBranchId,
    };
    for (const day of pillarsByIndex) {
      for (const hourBranchId of BRANCH_IDS) {
        const pillars = {
          year,
          month,
          day,
          hour: {
            stemId: expectedHourStemId(day.stemId, hourBranchId),
            branchId: hourBranchId,
          },
        };
        const rank19 = rankGrammarState19(pillars);
        if (rank19 !== checked) {
          throw new Error(`grammar state rank mismatch: expected ${checked}, received ${rank19}`);
        }
        const unranked = unrankGrammarState19(rank19);
        const code24 = packFourPillars24(pillars);
        const decoded = unpackFourPillars24(code24);
        for (const slot of pillarSlots) {
          if (decoded[slot].stemId !== pillars[slot].stemId
            || decoded[slot].branchId !== pillars[slot].branchId) {
            throw new Error(`code24 roundtrip failed at legal grammar state ${checked}`);
          }
          if (unranked[slot].stemId !== pillars[slot].stemId
            || unranked[slot].branchId !== pillars[slot].branchId) {
            throw new Error(`rank19 roundtrip failed at legal grammar state ${checked}`);
          }
        }
        if (rankGrammarState19(decoded) !== rank19) {
          throw new Error(`code24 to rank19 roundtrip failed at legal grammar state ${checked}`);
        }
        if (packFourPillars24(unranked) !== code24) {
          throw new Error(`rank19 to code24 roundtrip failed at legal grammar state ${checked}`);
        }
        digestUint32(rank19);
        digestUint32(code24);
        checked += 1;
      }
    }
  }
}

if (checked !== EXPECTED_GRAMMAR_STATES) {
  throw new Error(`unexpected legal grammar state count: ${checked}`);
}
if (checked !== GRAMMAR_STATE_COUNT) {
  throw new Error(`grammar state constant mismatch: expected ${checked}, received ${GRAMMAR_STATE_COUNT}`);
}
for (const reserved of [GRAMMAR_STATE_COUNT, (2 ** 19) - 1]) {
  try {
    unrankGrammarState19(reserved);
    throw new Error(`reserved 19-bit grammar state index accepted: ${reserved}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
}
flushDigest();
console.log(JSON.stringify({
  report: 'grammar_space_audit',
  auditedStates: checked,
  expectedStates: EXPECTED_GRAMMAR_STATES,
  candidateManifestHash,
  auditDigest: `sha256:${digest.digest('hex')}`,
}, null, 2));
