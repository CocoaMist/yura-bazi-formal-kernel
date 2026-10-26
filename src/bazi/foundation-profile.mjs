import { BRANCH_IDS, STEM_IDS } from './constants.mjs';

export const BAZI_STRUCTURAL_CODEBOOK_VERSION = 'bazi.structural_codebook.v1';
export const BAZI_STRUCTURAL_PROFILE_ID = 'bazi.structural_foundation_profile.v1';
export const HIDDEN_STEM_PROFILE_ID = 'bazi.hidden_stems.modern_common_order.v1';
export const GROWTH_STAGE_PROFILE_ID = 'bazi.growth_stage.ten_stem_yang_forward_yin_reverse_fire_earth.v1';
export const SEXAGENARY_XUN_VOID_PROFILE_ID = 'bazi.sexagenary_xun_void.cycle_anchor.v1';

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function codeDomain(bitWidth, rows) {
  return deepFreeze({
    bitWidth,
    valueCount: rows.length,
    reservedCodeCount: (2 ** bitWidth) - rows.length,
    values: rows,
  });
}

const ELEMENT_ROWS = [
  { id: 'wood', zh: '木', code: 0 },
  { id: 'fire', zh: '火', code: 1 },
  { id: 'earth', zh: '土', code: 2 },
  { id: 'metal', zh: '金', code: 3 },
  { id: 'water', zh: '水', code: 4 },
];

const POLARITY_ROWS = [
  { id: 'yang', zh: '阳', code: 0 },
  { id: 'yin', zh: '阴', code: 1 },
];

const ELEMENT_RELATION_ROWS = [
  { id: 'same', zh: '同行', code: 0 },
  { id: 'generates', zh: '我生', code: 1 },
  { id: 'generated_by', zh: '生我', code: 2 },
  { id: 'controls', zh: '我克', code: 3 },
  { id: 'controlled_by', zh: '克我', code: 4 },
];

const TEN_GOD_ROWS = [
  { id: 'peer', zh: '比肩', code: 0 },
  { id: 'rob_wealth', zh: '劫财', code: 1 },
  { id: 'food_god', zh: '食神', code: 2 },
  { id: 'hurting_officer', zh: '伤官', code: 3 },
  { id: 'indirect_wealth', zh: '偏财', code: 4 },
  { id: 'direct_wealth', zh: '正财', code: 5 },
  { id: 'seven_killings', zh: '七杀', code: 6 },
  { id: 'direct_officer', zh: '正官', code: 7 },
  { id: 'indirect_resource', zh: '偏印', code: 8 },
  { id: 'direct_resource', zh: '正印', code: 9 },
];

const STEM_ELEMENTS = [
  'wood', 'wood', 'fire', 'fire', 'earth',
  'earth', 'metal', 'metal', 'water', 'water',
];

const STEM_POLARITIES = [
  'yang', 'yin', 'yang', 'yin', 'yang',
  'yin', 'yang', 'yin', 'yang', 'yin',
];

const STEM_ZH = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

const STEM_ROWS = STEM_IDS.map((id, code) => ({
  id,
  zh: STEM_ZH[code],
  code,
  elementId: STEM_ELEMENTS[code],
  polarityId: STEM_POLARITIES[code],
}));

const BRANCH_ELEMENTS = [
  'water', 'earth', 'wood', 'wood', 'earth', 'fire',
  'fire', 'earth', 'metal', 'metal', 'earth', 'water',
];

const BRANCH_ZH = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const BRANCH_ROWS = BRANCH_IDS.map((id, code) => ({
  id,
  zh: BRANCH_ZH[code],
  code,
  nominalElementId: BRANCH_ELEMENTS[code],
  polarityId: code % 2 === 0 ? 'yang' : 'yin',
}));

const HIDDEN_STEM_ORDER_ROWS = [
  { id: 'position_0', code: 0 },
  { id: 'position_1', code: 1 },
  { id: 'position_2', code: 2 },
];

const GROWTH_STAGE_ROWS = [
  { id: 'chang_sheng', zh: '长生', code: 0 },
  { id: 'mu_yu', zh: '沐浴', code: 1 },
  { id: 'guan_dai', zh: '冠带', code: 2 },
  { id: 'lin_guan', zh: '临官', code: 3 },
  { id: 'di_wang', zh: '帝旺', code: 4 },
  { id: 'shuai', zh: '衰', code: 5 },
  { id: 'bing', zh: '病', code: 6 },
  { id: 'si', zh: '死', code: 7 },
  { id: 'mu', zh: '墓', code: 8 },
  { id: 'jue', zh: '绝', code: 9 },
  { id: 'tai', zh: '胎', code: 10 },
  { id: 'yang', zh: '养', code: 11 },
];

export const HIDDEN_STEM_PROFILE = deepFreeze({
  id: HIDDEN_STEM_PROFILE_ID,
  convention: 'modern_common_order',
  orderSemantics: 'neutral_order_index_only',
  weightInferred: false,
  branches: {
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
  },
});

export const GROWTH_STAGE_PROFILE = deepFreeze({
  id: GROWTH_STAGE_PROFILE_ID,
  conventionStatus: 'explicit_non_unique_traditional_convention',
  directionByPolarity: { yang: 'forward', yin: 'reverse' },
  birthStartBranchByStem: {
    jia: 'hai',
    yi: 'wu',
    bing: 'yin',
    ding: 'you',
    wu: 'yin',
    ji: 'you',
    geng: 'si',
    xin: 'zi',
    ren: 'shen',
    gui: 'mao',
  },
});

export const SEXAGENARY_XUN_VOID_PROFILE = deepFreeze({
  id: SEXAGENARY_XUN_VOID_PROFILE_ID,
  cycleStartPillarId: 'jia_zi',
  cycleSize: 60,
  xunSize: 10,
  branchCycleSize: 12,
  voidBranchOffsetsFromXunStart: [10, 11],
  semantics: 'deterministic_cycle_coordinate_only',
});

export const BAZI_STRUCTURAL_PROFILE = deepFreeze({
  id: BAZI_STRUCTURAL_PROFILE_ID,
  maturity: 'candidate',
  productAuthority: false,
  hiddenStemProfile: HIDDEN_STEM_PROFILE,
  growthStageProfile: GROWTH_STAGE_PROFILE,
  policy: {
    materialStatus: 'raw_structural',
    productAuthority: false,
    effectEligible: false,
    dayMasterSelfTenGod: 'peer_raw_relation',
    hiddenStemOrderSemantics: 'neutral_order_index_only',
    hiddenStemWeightInferred: false,
    strengthInferred: false,
    transformationInferred: false,
    favorabilityInferred: false,
  },
});

export const BAZI_STRUCTURAL_CODEBOOK = deepFreeze({
  version: BAZI_STRUCTURAL_CODEBOOK_VERSION,
  domains: {
    elements: codeDomain(3, ELEMENT_ROWS),
    polarities: codeDomain(1, POLARITY_ROWS),
    elementRelations: codeDomain(3, ELEMENT_RELATION_ROWS),
    tenGods: codeDomain(4, TEN_GOD_ROWS),
    stems: codeDomain(4, STEM_ROWS),
    branches: codeDomain(4, BRANCH_ROWS),
    hiddenStemOrders: codeDomain(2, HIDDEN_STEM_ORDER_ROWS),
    growthStages: codeDomain(4, GROWTH_STAGE_ROWS),
  },
  profile: BAZI_STRUCTURAL_PROFILE,
});

export function assertHiddenStemProfileCoverage(
  profile,
  branchIds = BRANCH_IDS,
) {
  if (!branchIds.every((branchId) => branchId in profile.branches)) {
    throw new Error('hidden-stem profile must cover every branch');
  }
  return true;
}

assertHiddenStemProfileCoverage(HIDDEN_STEM_PROFILE);
