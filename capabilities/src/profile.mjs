import { contentHash, deepFreeze } from './shared.mjs';

export const STEMS = Object.freeze(['jia', 'yi', 'bing', 'ding', 'wu', 'ji', 'geng', 'xin', 'ren', 'gui']);
export const BRANCHES = Object.freeze(['zi', 'chou', 'yin', 'mao', 'chen', 'si', 'wu', 'wei', 'shen', 'you', 'xu', 'hai']);
export const PILLAR_SLOTS = Object.freeze(['year', 'month', 'day', 'hour']);
export const TIME_LAYERS = Object.freeze(['decade', 'year', 'month', 'day', 'hour']);
export const SIX_LAYER_TEMPORAL_IDS = Object.freeze([
  'major_luck',
  'minor_luck',
  'year',
  'month',
  'day',
  'hour'
]);

const SIX_LAYER_TEMPORAL_PROFILE_BODY = {
  profileId: 'bazi.temporal_layers.explicit_six_pairwise.v1',
  layerIds: SIX_LAYER_TEMPORAL_IDS,
  relationClosure: 'all_declared_occurrence_pairs_once',
  derivedOccurrencePolicy: 'forbidden',
  transformationPolicy: 'candidate_only_not_established',
  evidenceStatus: 'interface_container_not_classical_six_layer_algorithm_claim',
  layerEvidence: {
    major_luck: 'local_transcription_term_and_duration_material',
    minor_luck: 'local_transcription_competing_algorithm_material',
    year: 'local_transcription_annual_taisui_material',
    month: 'external_input_slot_requires_independent_source',
    day: 'external_input_slot_requires_independent_source',
    hour: 'external_input_slot_requires_independent_source'
  },
  judgmentEligible: false,
  effectEligible: false,
  sourceRefs: [
    'library:book:purchased-20260831:三命通会-明-万民英:大运小运行年',
    'library:book:purchased-20260831:五行精纪-宋-廖中:大运小运太岁月日时',
    'library:book:wikisource-mingli:research-note:流年流月流日:体系对照'
  ]
};

export const SIX_LAYER_TEMPORAL_PROFILE = deepFreeze({
  ...SIX_LAYER_TEMPORAL_PROFILE_BODY,
  profileHash: contentHash(SIX_LAYER_TEMPORAL_PROFILE_BODY)
});

const RAW_RELATION_PROFILE_BODY = {
  profileId: 'bazi.raw_relations.common_reference.v1',
  effectEligible: false,
  sourceRefs: [
    'book:sanming-tonghui',
    'book:wuxing-jingji',
    'standard:gbt-33661-2017',
    'source-span:ctext:524726:0157199eb1cc80c1976aa2dbb403bcd8c64badef44099c1d377a59a9457d8240',
    'source-span:ctext:17583:d96fad0672f06f9aff0fbf15fb0efb56723df78e838267b00a14706bbc568f1f',
    'research:yuracore-time-system-comparison'
  ]
};

export const RAW_RELATION_PROFILE = deepFreeze({
  ...RAW_RELATION_PROFILE_BODY,
  profileHash: contentHash(RAW_RELATION_PROFILE_BODY)
});
