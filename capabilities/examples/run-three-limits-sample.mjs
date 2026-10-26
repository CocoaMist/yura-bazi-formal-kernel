import { writeFile } from 'node:fs/promises';
import {
  AGE_COORDINATE_VERSION,
  LIFE_STAGE_MATCH_REQUEST_VERSION,
  LIFE_STAGE_PROFILE_IDS,
  PROVENANCE_VERSION,
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  captureChartRecord,
  evaluateTemporal,
  resolveTimeRequest
} from '../src/index.mjs';
import { contentHash } from '../src/shared.mjs';

const BIRTH_VALID_TIME_REF = 'time:2000-07-19T16:00:00+08:00';
const QUERY_LOCAL = '2026-09-02T16:00:00';

const chartSource = {
  fixtureVersion: 'bazi.natal_compiler_golden.v1',
  subjectRef: 'subject:2000-07-19-beijing-male',
  snapshotRef: 'snapshot:geng-chen_gui-wei_wu-yin_geng-shen',
  validTimeRef: BIRTH_VALID_TIME_REF
};

const chartInput = {
  version: 'bazi.capability_chart.v1',
  subjectRef: chartSource.subjectRef,
  snapshotRef: chartSource.snapshotRef,
  validTimeRef: chartSource.validTimeRef,
  pillars: {
    year: { stemId: 'geng', branchId: 'chen' },
    month: { stemId: 'gui', branchId: 'wei' },
    day: { stemId: 'wu', branchId: 'yin' },
    hour: { stemId: 'geng', branchId: 'shen' }
  },
  provenance: {
    version: PROVENANCE_VERSION,
    authorityId: 'yuracore.natal_compiler_golden_fixture',
    authorityVersion: '1.0.0',
    sourceRefs: [
      'workspace:tests/fixtures/natal-compiler-golden.json',
      'workspace:examples/2000-07-19-beijing-male.input.json'
    ],
    algorithmRefs: [],
    requestHash: contentHash(chartSource)
  }
};
const chart = captureChartRecord(chartInput);

const timeRequest = {
  version: 'bazi.time_request.v1',
  mode: 'instant',
  calendar: 'gregorian',
  timeZoneId: 'Asia/Shanghai',
  location: { longitude: 116.4074, latitude: 39.9042, label: 'Beijing' },
  solarTime: { mode: 'civil' },
  boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
  input: { local: QUERY_LOCAL }
};
const calendarResolution = await resolveTimeRequest(timeRequest, REFERENCE_CALENDAR_PROVIDER);

const ageCoordinate = {
  version: AGE_COORDINATE_VERSION,
  coordinateId: 'age:elapsed-anniversary:2026-09-02:life-year-27',
  lifeYearOrdinal: 27,
  reckoningProfileId: 'bazi.age_reckoning.elapsed_anniversary_life_year_ordinal.v1',
  birthValidTimeRef: BIRTH_VALID_TIME_REF,
  at: calendarResolution.resolved.at,
  decisionRefs: [
    'input:birth:2000-07-19T16:00:00+08:00',
    'decision:twenty-six-completed-anniversaries-enters-life-year-27'
  ]
};
const lifeStageRequest = {
  version: LIFE_STAGE_MATCH_REQUEST_VERSION,
  profileIds: [...LIFE_STAGE_PROFILE_IDS],
  ageCoordinates: [ageCoordinate]
};

const temporalQuery = {
  version: calendarResolution.resolved.version,
  mode: calendarResolution.resolved.mode,
  at: calendarResolution.resolved.at,
  layers: calendarResolution.resolved.layers,
  provenance: calendarResolution.resolved.provenance,
  decisionTrace: calendarResolution.resolved.decisionTrace
};
const temporalEvaluation = evaluateTemporal(chartInput, temporalQuery, { lifeStageRequest });
const segment = temporalEvaluation.segments[0];
const observations = temporalEvaluation.lifeStageMatchSet.candidates.map((candidate) => ({
  profileId: candidate.profileId,
  modelId: candidate.modelId,
  boundaryInterpretationId: candidate.boundaryInterpretationId,
  stageId: candidate.stageId,
  lifeYearOrdinal: candidate.lifeYearOrdinal,
  governingPillarOccurrenceRefs: candidate.governingPillarOccurrenceRefs,
  candidateId: candidate.candidateId
}));

const body = {
  version: 'bazi.three_limits_temporal_sample.v1',
  generatedFor: {
    birthInput: '2000-07-19T16:00:00+08:00',
    place: 'Beijing',
    traditionalSexClass: 'male',
    queryLocal: QUERY_LOCAL
  },
  scope: {
    semantics: 'research_only_structural_candidates',
    sourceLocatorsVerified: false,
    competingProfilesAveraged: false,
    judgmentProduced: false,
    eventProduced: false,
    deathOrLongevityClaimProduced: false,
    effectEligible: false
  },
  chart,
  timeRequest,
  calendarResolution,
  explicitAgeCoordinate: temporalEvaluation.lifeStageMatchSet.ageCoordinates[0],
  observations,
  temporalSummary: {
    at: segment.at,
    layers: segment.layers,
    natalRelationCount: segment.natalRelations.length,
    timeRelationCount: segment.timeRelations.length,
    completeBranchGroupCount: segment.branchGroups.length,
    lifeStageCandidateCount: temporalEvaluation.lifeStageMatchSet.candidateCount,
    evaluationId: temporalEvaluation.evaluationId,
    lifeStageMatchSetHash: temporalEvaluation.lifeStageMatchSet.lifeStageMatchSetHash
  },
  temporalEvaluation
};
const artifact = { ...body, artifactHash: contentHash(body) };
const outputUrl = new URL('./three-limits-sample-2026-09-02.json', import.meta.url);
await writeFile(outputUrl, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  output: outputUrl.pathname,
  artifactHash: artifact.artifactHash,
  at: segment.at,
  layers: segment.layers,
  observations
}, null, 2)}\n`);
