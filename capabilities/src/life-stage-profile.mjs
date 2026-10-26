import { PILLAR_SLOTS } from './profile.mjs';
import { contentHash, deepFreeze, fail } from './shared.mjs';

export const LIFE_STAGE_PROFILE_VERSION = 'bazi.life_stage_profile.v1';

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function segment(stageId, fromLifeYearOrdinal, untilLifeYearOrdinalExclusive, governingNatalSlots) {
  return {
    stageId,
    fromLifeYearOrdinal,
    untilLifeYearOrdinalExclusive,
    governingNatalSlots
  };
}

function model(modelId, boundaryInterpretationId, overlapPolicy, segments) {
  return { modelId, boundaryInterpretationId, overlapPolicy, segments };
}

function profile(body) {
  if (body.version !== LIFE_STAGE_PROFILE_VERSION) fail('life-stage profile version is unsupported');
  if (!Array.isArray(body.sourceRefs) || body.sourceRefs.length === 0) fail('life-stage profile sourceRefs must not be empty');
  if (body.evidenceStatus !== 'research_only_local_transcription_corroborated') {
    fail('life-stage profile must remain research-only until trusted source spans are admitted');
  }
  if (body.effectEligible !== false || body.maximumLifeYearOrdinal !== 100) {
    fail('life-stage profile must be effect-ineligible and bounded to one hundred life years');
  }
  const modelIds = new Set();
  for (const candidateModel of body.models) {
    if (modelIds.has(candidateModel.modelId)) fail('life-stage model IDs must be unique');
    modelIds.add(candidateModel.modelId);
    if (!['disjoint_partition', 'retain_all_matching_segments'].includes(candidateModel.overlapPolicy)) {
      fail('life-stage model overlap policy is unsupported');
    }
    const segmentIds = new Set();
    for (const candidateSegment of candidateModel.segments) {
      if (segmentIds.has(candidateSegment.stageId)) fail('life-stage segment IDs must be unique within a model');
      segmentIds.add(candidateSegment.stageId);
      if (!Number.isInteger(candidateSegment.fromLifeYearOrdinal)
        || !Number.isInteger(candidateSegment.untilLifeYearOrdinalExclusive)
        || candidateSegment.fromLifeYearOrdinal < 1
        || candidateSegment.untilLifeYearOrdinalExclusive > 101
        || candidateSegment.fromLifeYearOrdinal >= candidateSegment.untilLifeYearOrdinalExclusive) {
        fail('life-stage segment bounds must be integer half-open life-year ordinals within [1, 101)');
      }
      if (!Array.isArray(candidateSegment.governingNatalSlots)
        || candidateSegment.governingNatalSlots.length === 0
        || new Set(candidateSegment.governingNatalSlots).size !== candidateSegment.governingNatalSlots.length
        || candidateSegment.governingNatalSlots.some((slot) => !PILLAR_SLOTS.includes(slot))) {
        fail('life-stage governing natal slots must be a unique non-empty pillar-slot list');
      }
    }
    for (let lifeYear = 1; lifeYear <= 100; lifeYear += 1) {
      const matches = candidateModel.segments.filter((candidateSegment) =>
        candidateSegment.fromLifeYearOrdinal <= lifeYear
        && lifeYear < candidateSegment.untilLifeYearOrdinalExclusive);
      if (matches.length === 0) fail('life-stage model must cover every life-year ordinal in [1, 100]');
      if (candidateModel.overlapPolicy === 'disjoint_partition' && matches.length !== 1) {
        fail('disjoint life-stage model must match exactly one segment per life year');
      }
    }
  }
  const preimage = {
    ...body,
    sourceRefs: [...body.sourceRefs],
    models: body.models.map((candidateModel) => ({
      ...candidateModel,
      segments: candidateModel.segments.map((candidateSegment) => ({
        ...candidateSegment,
        governingNatalSlots: [...candidateSegment.governingNatalSlots]
      }))
    }))
  };
  return deepFreeze({ ...preimage, profileHash: contentHash(preimage) });
}

const WUXING_JINGJI_PROFILE = profile({
  version: LIFE_STAGE_PROFILE_VERSION,
  profileId: 'bazi.life_stage.three_limits.wuxing_jingji_25_25_50.v1',
  maximumLifeYearOrdinal: 100,
  evidenceStatus: 'research_only_local_transcription_corroborated',
  materialStatus: 'traditional_life_stage_candidate',
  effectEligible: false,
  sourceRefs: [
    'source-locator:local-transcription:yuracore:wuxing-jingji:purchased:L1613-L1616',
    'source-locator:local-transcription:yuracore:wuxing-jingji:wikisource:L3022-L3028',
    'research:gpt-5.6-pro:three-limits-synthesis:2026-09-02'
  ],
  sourceBoundaryNotes: [
    'The supplied synthesis assigns 25, 25 and 50 life years to initial, middle and final limits.',
    'Single-pillar and adjacent-pair governance are retained as separate models and are never averaged.'
  ],
  models: [
    model(
      'bazi.life_stage_model.wuxing_jingji.single_pillar.v1',
      'life_years_1_25__26_50__51_100',
      'disjoint_partition',
      [
        segment('initial_limit', 1, 26, ['month']),
        segment('middle_limit', 26, 51, ['day']),
        segment('final_limit', 51, 101, ['hour'])
      ]
    ),
    model(
      'bazi.life_stage_model.wuxing_jingji.adjacent_pair.v1',
      'life_years_1_25__26_50__51_100',
      'disjoint_partition',
      [
        segment('initial_limit', 1, 26, ['year', 'month']),
        segment('middle_limit', 26, 51, ['month', 'day']),
        segment('final_limit', 51, 101, ['day', 'hour'])
      ]
    )
  ]
});

const WUXING_JINGJI_ZHU_SHEN_JING_PROFILE = profile({
  version: LIFE_STAGE_PROFILE_VERSION,
  profileId: 'bazi.life_stage.three_limits.wuxing_jingji_zhu_shen_jing_30_15_55.v1',
  maximumLifeYearOrdinal: 100,
  evidenceStatus: 'research_only_local_transcription_corroborated',
  materialStatus: 'traditional_life_stage_candidate',
  effectEligible: false,
  sourceRefs: [
    'source-locator:local-transcription:yuracore:wuxing-jingji:purchased:L4112-L4113',
    'source-locator:local-transcription:yuracore:wuxing-jingji:wikisource:L7966-L7968',
    'attribution:zhu-shen-jing:via-wuxing-jingji',
    'research:gpt-5.6-pro:three-limits-synthesis:2026-09-02'
  ],
  sourceBoundaryNotes: [
    'Local Wuxing Jingji transcriptions under Lun Shou Yao, attributed there to Zhu Shen Jing, state month 1-30, day 31-45 and hour 45-100.',
    'The disjoint partition interprets the arithmetic 30+15+55 as life years 46-100 for the final limit.',
    'The literal boundary model retains life year 45 in both middle and final limits instead of silently choosing one.',
    'The supplied synthesis attributes this passage to Sanming Tonghui, but no matching passage was found in the two locally searched Sanming Tonghui transcriptions.'
  ],
  models: [
    model(
      'bazi.life_stage_model.wuxing_jingji_zhu_shen_jing.partition_30_15_55.v1',
      'life_years_1_30__31_45__46_100',
      'disjoint_partition',
      [
        segment('initial_limit', 1, 31, ['month']),
        segment('middle_limit', 31, 46, ['day']),
        segment('final_limit', 46, 101, ['hour'])
      ]
    ),
    model(
      'bazi.life_stage_model.wuxing_jingji_zhu_shen_jing.literal_45_onward.v1',
      'life_years_1_30__31_45__45_100_overlap_retained',
      'retain_all_matching_segments',
      [
        segment('initial_limit', 1, 31, ['month']),
        segment('middle_limit', 31, 46, ['day']),
        segment('final_limit', 45, 101, ['hour'])
      ]
    )
  ]
});

export const LIFE_STAGE_PROFILES = deepFreeze({
  [WUXING_JINGJI_PROFILE.profileId]: WUXING_JINGJI_PROFILE,
  [WUXING_JINGJI_ZHU_SHEN_JING_PROFILE.profileId]: WUXING_JINGJI_ZHU_SHEN_JING_PROFILE
});

export const LIFE_STAGE_PROFILE_IDS = Object.freeze(Object.keys(LIFE_STAGE_PROFILES).sort(compareCodeUnits));

export function selectLifeStageProfiles(profileIds) {
  if (!Array.isArray(profileIds) || Object.getPrototypeOf(profileIds) !== Array.prototype || profileIds.length === 0) {
    fail('lifeStageRequest.profileIds must be a non-empty plain array');
  }
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < profileIds.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(profileIds, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
      fail(`lifeStageRequest.profileIds[${index}] must be an own string value`);
    }
    const profileId = descriptor.value;
    if (!Object.hasOwn(LIFE_STAGE_PROFILES, profileId)) fail(`unknown life-stage profile: ${profileId}`);
    if (seen.has(profileId)) fail('lifeStageRequest.profileIds must be unique');
    seen.add(profileId);
    selected.push(LIFE_STAGE_PROFILES[profileId]);
  }
  return selected.sort((left, right) => compareCodeUnits(left.profileId, right.profileId));
}
