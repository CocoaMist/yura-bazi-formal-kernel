import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_COORDINATE_VERSION,
  LIFE_STAGE_MATCH_REQUEST_VERSION,
  LIFE_STAGE_PROFILE_IDS,
  LIFE_STAGE_PROFILES,
  buildLifeStageTimeline,
  captureAgeCoordinate,
  evaluateTemporal,
  matchLifeStageCandidates
} from '../src/index.mjs';
import { contentHash } from '../src/shared.mjs';
import { instantQuery, layersA, provenance, rangeQuery } from './fixtures.mjs';

const WUXING = 'bazi.life_stage.three_limits.wuxing_jingji_25_25_50.v1';
const WUXING_ZHU_SHEN = 'bazi.life_stage.three_limits.wuxing_jingji_zhu_shen_jing_30_15_55.v1';
const AT = '2026-09-02T08:00:00.000Z';
const BIRTH_REF = 'birth:2000-07-19T16:00:00+08:00';

function sampleChart(overrides = {}) {
  return {
    version: 'bazi.capability_chart.v1',
    subjectRef: 'subject:sample-2000-07-19-beijing',
    snapshotRef: 'snapshot:geng-chen_gui-wei_wu-yin_geng-shen',
    validTimeRef: BIRTH_REF,
    pillars: {
      year: { stemId: 'geng', branchId: 'chen' },
      month: { stemId: 'gui', branchId: 'wei' },
      day: { stemId: 'wu', branchId: 'yin' },
      hour: { stemId: 'geng', branchId: 'shen' }
    },
    provenance: provenance({
      authorityId: 'test-fixed-snapshot',
      authorityVersion: '1.0.0',
      sourceRefs: ['test:fixed-sample:14738640:143456']
    }),
    ...overrides
  };
}

function coordinate(lifeYearOrdinal, coordinateId = `age:${lifeYearOrdinal}`, overrides = {}) {
  return {
    version: AGE_COORDINATE_VERSION,
    coordinateId,
    lifeYearOrdinal,
    reckoningProfileId: 'bazi.age_reckoning.elapsed_anniversary_life_year_ordinal.v1',
    birthValidTimeRef: BIRTH_REF,
    at: AT,
    decisionRefs: ['test:age-coordinate:explicit'],
    ...overrides
  };
}

function request(lifeYearOrdinal, profileIds = [WUXING, WUXING_ZHU_SHEN], overrides = {}) {
  return {
    version: LIFE_STAGE_MATCH_REQUEST_VERSION,
    profileIds,
    ageCoordinates: [coordinate(lifeYearOrdinal)],
    ...overrides
  };
}

function without(object, key) {
  const output = { ...object };
  delete output[key];
  return output;
}

test('two three-limit profiles and every interpretation stay versioned and research-only', () => {
  assert.deepEqual(LIFE_STAGE_PROFILE_IDS, [WUXING, WUXING_ZHU_SHEN]);
  assert.equal(Object.isFrozen(LIFE_STAGE_PROFILES), true);
  for (const profile of Object.values(LIFE_STAGE_PROFILES)) {
    assert.equal(profile.evidenceStatus, 'research_only_local_transcription_corroborated');
    assert.equal(profile.effectEligible, false);
    assert.match(profile.profileHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(Object.isFrozen(profile.models), true);
  }
  assert.equal(LIFE_STAGE_PROFILES[WUXING].models.length, 2);
  assert.equal(LIFE_STAGE_PROFILES[WUXING_ZHU_SHEN].models.length, 2);
  assert.ok(LIFE_STAGE_PROFILES[WUXING_ZHU_SHEN].sourceRefs.some((ref) => ref.includes('zhu-shen-jing')));
  assert.ok(LIFE_STAGE_PROFILES[WUXING_ZHU_SHEN].sourceRefs.every((ref) => !ref.includes('sanming-tonghui')));
});

test('life year 27 exposes the source disagreement without averaging it', () => {
  const result = matchLifeStageCandidates(sampleChart(), request(27));
  assert.equal(result.candidateCount, 4);
  const wuxing = result.candidates.filter((candidate) => candidate.profileId === WUXING);
  const wuxingZhuShen = result.candidates.filter((candidate) => candidate.profileId === WUXING_ZHU_SHEN);
  assert.equal(wuxing.length, 2);
  assert.ok(wuxing.every((candidate) => candidate.stageId === 'middle_limit'));
  assert.deepEqual(
    wuxing.map((candidate) => candidate.governingPillarOccurrenceRefs).sort((left, right) => left.length - right.length),
    [['natal.day'], ['natal.month', 'natal.day']]
  );
  assert.equal(wuxingZhuShen.length, 2);
  assert.ok(wuxingZhuShen.every((candidate) => candidate.stageId === 'initial_limit'));
  assert.ok(wuxingZhuShen.every((candidate) => candidate.governingPillarOccurrenceRefs[0] === 'natal.month'));
  assert.ok(result.candidates.every((candidate) => candidate.utility === 'indeterminate' && candidate.effectEligible === false));
  const preimage = without(result, 'lifeStageMatchSetHash');
  assert.equal(result.lifeStageMatchSetHash, contentHash(preimage));
});

test('boundaries are exact and the Wuxing Jingji Zhu Shen Jing age-45 ambiguity remains visible', () => {
  for (const [age, stage] of [[25, 'initial_limit'], [26, 'middle_limit'], [50, 'middle_limit'], [51, 'final_limit']]) {
    const matches = matchLifeStageCandidates(sampleChart(), request(age, [WUXING])).candidates;
    assert.equal(matches.length, 2);
    assert.ok(matches.every((candidate) => candidate.stageId === stage));
  }
  const at45 = matchLifeStageCandidates(sampleChart(), request(45, [WUXING_ZHU_SHEN])).candidates;
  assert.equal(at45.length, 3);
  assert.deepEqual(at45.map((candidate) => candidate.stageId).sort(), ['final_limit', 'middle_limit', 'middle_limit']);
  const at46 = matchLifeStageCandidates(sampleChart(), request(46, [WUXING_ZHU_SHEN])).candidates;
  assert.equal(at46.length, 2);
  assert.ok(at46.every((candidate) => candidate.stageId === 'final_limit'));
});

test('profile and age-candidate input order cannot change match-set identity', () => {
  const first = matchLifeStageCandidates(sampleChart(), {
    version: LIFE_STAGE_MATCH_REQUEST_VERSION,
    profileIds: [WUXING, WUXING_ZHU_SHEN],
    ageCoordinates: [coordinate(27, 'age:b'), coordinate(27, 'age:a')]
  });
  const second = matchLifeStageCandidates(sampleChart(), {
    version: LIFE_STAGE_MATCH_REQUEST_VERSION,
    profileIds: [WUXING_ZHU_SHEN, WUXING],
    ageCoordinates: [coordinate(27, 'age:a'), coordinate(27, 'age:b')]
  });
  assert.deepEqual(second, first);
  assert.equal(first.candidateCount, 8);
});

test('outside-range age coordinates remain explicit and are never silently discarded', () => {
  const result = matchLifeStageCandidates(sampleChart(), request(101));
  assert.equal(result.candidateCount, 0);
  assert.equal(result.outsideProfileRange.length, 2);
  assert.ok(result.outsideProfileRange.every((item) => item.status === 'outside_profile_range'));
});

test('timeline is a compact three-boundary profile set, not one row per age', () => {
  const timeline = buildLifeStageTimeline([WUXING, WUXING_ZHU_SHEN]);
  assert.equal(timeline.candidateProfileCount, 2);
  assert.equal(timeline.semantics, 'competing_profiles_never_averaged');
  assert.equal(timeline.effectEligible, false);
  assert.equal(timeline.profileRefs.flatMap((profile) => profile.models).length, 4);
  assert.equal(timeline.timelineHash, contentHash(without(timeline, 'timelineHash')));
});

test('instant temporal evaluation can carry the age-stage set without creating a judgment', () => {
  const query = instantQuery({ at: AT, layers: layersA });
  const result = evaluateTemporal(sampleChart(), query, { lifeStageRequest: request(27) });
  assert.equal(result.lifeStageMatchSet.candidateCount, 4);
  assert.equal(result.lifeStageMatchSet.ageCoordinates[0].at, AT);
  assert.equal(result.utility, 'indeterminate');
  assert.equal(result.effectEligible, false);

  const range = rangeQuery();
  assert.throws(() => evaluateTemporal(sampleChart(), range, { lifeStageRequest: request(27) }), /requires an instant/);
  assert.throws(() => evaluateTemporal(sampleChart(), query, {
    lifeStageRequest: request(27, [WUXING], {
      ageCoordinates: [coordinate(27, 'age:wrong-at', { at: '2026-09-03T08:00:00Z' })]
    })
  }), /bound to the evaluated temporal instant/);
});

test('age coordinates fail closed on identity drift, duplicates, unknown profiles and accessors', () => {
  assert.throws(() => matchLifeStageCandidates(sampleChart(), request(0)), /\[1, 120\]/);
  assert.throws(() => matchLifeStageCandidates(sampleChart(), request(27, ['unknown.profile'])), /unknown/);
  assert.throws(() => matchLifeStageCandidates(sampleChart(), {
    version: LIFE_STAGE_MATCH_REQUEST_VERSION,
    profileIds: [WUXING, WUXING],
    ageCoordinates: [coordinate(27)]
  }), /unique/);
  assert.throws(() => matchLifeStageCandidates(sampleChart(), request(27, [WUXING], {
    ageCoordinates: [coordinate(27, 'age:drift', { birthValidTimeRef: 'birth:other' })]
  })), /birthValidTimeRef/);

  let invoked = false;
  const malicious = coordinate(27);
  Object.defineProperty(malicious, 'lifeYearOrdinal', {
    enumerable: true,
    get() { invoked = true; return 27; }
  });
  assert.throws(() => captureAgeCoordinate(malicious), /own data/);
  assert.equal(invoked, false);
});

test('life-stage candidates expose no score, strength, event or death semantics', () => {
  const result = matchLifeStageCandidates(sampleChart(), request(27));
  const forbidden = ['score', 'strength', 'judgment', 'event', 'death', 'activation', 'effectTemplate'];
  const serialized = JSON.stringify(result);
  for (const field of forbidden) assert.equal(serialized.includes(`\"${field}\"`), false);
});
