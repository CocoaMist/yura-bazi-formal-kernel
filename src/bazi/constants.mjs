export const STEM_IDS = Object.freeze([
  'jia', 'yi', 'bing', 'ding', 'wu', 'ji', 'geng', 'xin', 'ren', 'gui',
]);

export const BRANCH_IDS = Object.freeze([
  'zi', 'chou', 'yin', 'mao', 'chen', 'si', 'wu', 'wei', 'shen', 'you', 'xu', 'hai',
]);

export const PILLAR_SLOTS = Object.freeze(['year', 'month', 'day', 'hour']);

const STEM_INDEX = new Map(STEM_IDS.map((id, index) => [id, index]));
const BRANCH_INDEX = new Map(BRANCH_IDS.map((id, index) => [id, index]));

export const SEXAGENARY_PILLARS = Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({
  index,
  stemId: STEM_IDS[index % STEM_IDS.length],
  branchId: BRANCH_IDS[index % BRANCH_IDS.length],
  id: `${STEM_IDS[index % STEM_IDS.length]}_${BRANCH_IDS[index % BRANCH_IDS.length]}`,
})));

const SEXAGENARY_INDEX = new Map(
  SEXAGENARY_PILLARS.map((pillar) => [`${pillar.stemId}:${pillar.branchId}`, pillar.index]),
);

export const stemIndexOf = (stemId) => STEM_INDEX.get(stemId);
export const branchIndexOf = (branchId) => BRANCH_INDEX.get(branchId);
export const sexagenaryIndexOf = (stemId, branchId) => SEXAGENARY_INDEX.get(`${stemId}:${branchId}`);
