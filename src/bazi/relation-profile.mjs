import {
  BAZI_STRUCTURAL_CODEBOOK,
  BAZI_STRUCTURAL_CODEBOOK_VERSION,
} from './foundation-profile.mjs';

export const BAZI_RELATION_CODEBOOK_VERSION = 'bazi.relation_codebook.v3';
export const BAZI_RELATION_PROFILE_ID = 'bazi.relation_foundation.modern_common_raw_structure.v4';

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

function flagDomain(bitWidth, rows) {
  return deepFreeze({
    bitWidth,
    flagCount: rows.length,
    combinationCount: 2 ** bitWidth,
    values: rows,
  });
}

const STEM_COMBINATION_FLAG_ROWS = [
  { id: 'five_combination_candidate', zh: '五合候选', bitIndex: 0, bitMask: 1 },
];

const BRANCH_PAIR_RELATION_FLAG_ROWS = [
  { id: 'six_harmony', zh: '六合', bitIndex: 0, bitMask: 1 },
  { id: 'clash', zh: '冲', bitIndex: 1, bitMask: 2 },
  { id: 'punishment', zh: '刑', bitIndex: 2, bitMask: 4 },
  { id: 'harm', zh: '害', bitIndex: 3, bitMask: 8 },
  { id: 'break', zh: '破', bitIndex: 4, bitMask: 16 },
];

const PILLAR_PAIR_ROWS = [
  { id: 'year_month', code: 0, leftSlot: 'year', rightSlot: 'month' },
  { id: 'year_day', code: 1, leftSlot: 'year', rightSlot: 'day' },
  { id: 'year_hour', code: 2, leftSlot: 'year', rightSlot: 'hour' },
  { id: 'month_day', code: 3, leftSlot: 'month', rightSlot: 'day' },
  { id: 'month_hour', code: 4, leftSlot: 'month', rightSlot: 'hour' },
  { id: 'day_hour', code: 5, leftSlot: 'day', rightSlot: 'hour' },
];

const HYPEREDGE_GROUP_ROWS = [
  {
    id: 'three_harmony_water', zh: '申子辰三合', code: 0,
    relationId: 'three_harmony', memberBranchIds: ['shen', 'zi', 'chen'],
  },
  {
    id: 'three_harmony_wood', zh: '亥卯未三合', code: 1,
    relationId: 'three_harmony', memberBranchIds: ['hai', 'mao', 'wei'],
  },
  {
    id: 'three_harmony_fire', zh: '寅午戌三合', code: 2,
    relationId: 'three_harmony', memberBranchIds: ['yin', 'wu', 'xu'],
  },
  {
    id: 'three_harmony_metal', zh: '巳酉丑三合', code: 3,
    relationId: 'three_harmony', memberBranchIds: ['si', 'you', 'chou'],
  },
  {
    id: 'three_meeting_water', zh: '亥子丑三会', code: 4,
    relationId: 'three_meeting', memberBranchIds: ['hai', 'zi', 'chou'],
  },
  {
    id: 'three_meeting_wood', zh: '寅卯辰三会', code: 5,
    relationId: 'three_meeting', memberBranchIds: ['yin', 'mao', 'chen'],
  },
  {
    id: 'three_meeting_fire', zh: '巳午未三会', code: 6,
    relationId: 'three_meeting', memberBranchIds: ['si', 'wu', 'wei'],
  },
  {
    id: 'three_meeting_metal', zh: '申酉戌三会', code: 7,
    relationId: 'three_meeting', memberBranchIds: ['shen', 'you', 'xu'],
  },
  {
    id: 'punishment_yin_si_shen', zh: '寅巳申三刑组', code: 8,
    relationId: 'punishment_group', memberBranchIds: ['yin', 'si', 'shen'],
  },
  {
    id: 'punishment_chou_xu_wei', zh: '丑戌未三刑组', code: 9,
    relationId: 'punishment_group', memberBranchIds: ['chou', 'xu', 'wei'],
  },
];

const STEM_COMBINATION_PAIRS = [
  {
    id: 'jia_ji', zh: '甲己合', memberStemIds: ['jia', 'ji'],
    traditionalCorrespondenceElementId: 'earth',
  },
  {
    id: 'yi_geng', zh: '乙庚合', memberStemIds: ['yi', 'geng'],
    traditionalCorrespondenceElementId: 'metal',
  },
  {
    id: 'bing_xin', zh: '丙辛合', memberStemIds: ['bing', 'xin'],
    traditionalCorrespondenceElementId: 'water',
  },
  {
    id: 'ding_ren', zh: '丁壬合', memberStemIds: ['ding', 'ren'],
    traditionalCorrespondenceElementId: 'wood',
  },
  {
    id: 'wu_gui', zh: '戊癸合', memberStemIds: ['wu', 'gui'],
    traditionalCorrespondenceElementId: 'fire',
  },
];

const BRANCH_PAIR_CANDIDATES = {
  six_harmony: [
    ['zi', 'chou'], ['yin', 'hai'], ['mao', 'xu'],
    ['chen', 'you'], ['si', 'shen'], ['wu', 'wei'],
  ],
  clash: [
    ['zi', 'wu'], ['chou', 'wei'], ['yin', 'shen'],
    ['mao', 'you'], ['chen', 'xu'], ['si', 'hai'],
  ],
  punishment: [
    ['yin', 'si'], ['si', 'shen'], ['shen', 'yin'],
    ['chou', 'xu'], ['xu', 'wei'], ['wei', 'chou'],
    ['zi', 'mao'], ['mao', 'zi'],
    ['chen', 'chen'], ['wu', 'wu'], ['you', 'you'], ['hai', 'hai'],
  ],
  harm: [
    ['zi', 'wei'], ['chou', 'wu'], ['yin', 'si'],
    ['mao', 'chen'], ['shen', 'hai'], ['you', 'xu'],
  ],
  break: [
    ['zi', 'you'], ['chou', 'chen'], ['yin', 'hai'],
    ['mao', 'wu'], ['si', 'shen'], ['wei', 'xu'],
  ],
};

export const BAZI_RELATION_PROFILE = deepFreeze({
  id: BAZI_RELATION_PROFILE_ID,
  codebookVersion: BAZI_RELATION_CODEBOOK_VERSION,
  foundationCodebookVersion: BAZI_STRUCTURAL_CODEBOOK_VERSION,
  conventionStatus: 'explicit_non_unique_traditional_convention',
  scope: {
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
  },
  excludedDerivations: [
    'half_harmony',
    'arching_harmony',
    'dark_harmony',
    'competing_combination',
    'combination_binding',
    'combination_transformation',
  ],
  policy: {
    materialStatus: 'raw_relation_candidate',
    productAuthority: false,
    effectEligible: false,
    transformationInferred: false,
    strengthInferred: false,
    favorabilityInferred: false,
    directionalityInferred: false,
    precedenceInferred: false,
  },
  fixedPillarPairs: PILLAR_PAIR_ROWS,
  stemCombinationPairs: STEM_COMBINATION_PAIRS,
  branchPairCandidates: BRANCH_PAIR_CANDIDATES,
  completeHyperedgeGroups: HYPEREDGE_GROUP_ROWS,
});

export const BAZI_RELATION_CODEBOOK = deepFreeze({
  version: BAZI_RELATION_CODEBOOK_VERSION,
  foundationCodebookVersion: BAZI_STRUCTURAL_CODEBOOK_VERSION,
  domains: {
    elements: BAZI_STRUCTURAL_CODEBOOK.domains.elements,
    elementRelations: BAZI_STRUCTURAL_CODEBOOK.domains.elementRelations,
    stemCombinationFlags: flagDomain(1, STEM_COMBINATION_FLAG_ROWS),
    branchPairRelationFlags: flagDomain(5, BRANCH_PAIR_RELATION_FLAG_ROWS),
    pillarPairs: codeDomain(3, PILLAR_PAIR_ROWS),
    completeHyperedgeGroups: codeDomain(4, HYPEREDGE_GROUP_ROWS),
  },
  profile: BAZI_RELATION_PROFILE,
});
