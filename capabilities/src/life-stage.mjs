import { captureChartRecord } from './contracts.mjs';
import { LIFE_STAGE_PROFILE_IDS, selectLifeStageProfiles } from './life-stage-profile.mjs';
import {
  assertNonEmptyString,
  canonicalInstant,
  captureRecord,
  contentHash,
  deepFreeze,
  fail
} from './shared.mjs';

export const AGE_COORDINATE_VERSION = 'bazi.age_coordinate.v1';
export const LIFE_STAGE_MATCH_REQUEST_VERSION = 'bazi.life_stage_match_request.v1';
export const LIFE_STAGE_MATCH_SET_VERSION = 'bazi.life_stage_match_set.v1';

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function captureStringList(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) {
    fail(`${label} must be a non-empty plain array`);
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label}[${index}] must be own data`);
    output.push(assertNonEmptyString(descriptor.value, `${label}[${index}]`));
  }
  return output;
}

export function captureAgeCoordinate(value, label = 'ageCoordinate') {
  const input = captureRecord(value, label, [
    'version', 'coordinateId', 'lifeYearOrdinal', 'reckoningProfileId',
    'birthValidTimeRef', 'at', 'decisionRefs'
  ]);
  if (input.version !== AGE_COORDINATE_VERSION) fail(`${label}.version is unsupported`);
  if (!Number.isInteger(input.lifeYearOrdinal) || input.lifeYearOrdinal < 1 || input.lifeYearOrdinal > 120) {
    fail(`${label}.lifeYearOrdinal must be an integer in [1, 120]`);
  }
  const body = {
    version: input.version,
    coordinateId: assertNonEmptyString(input.coordinateId, `${label}.coordinateId`),
    lifeYearOrdinal: input.lifeYearOrdinal,
    reckoningProfileId: assertNonEmptyString(input.reckoningProfileId, `${label}.reckoningProfileId`),
    birthValidTimeRef: assertNonEmptyString(input.birthValidTimeRef, `${label}.birthValidTimeRef`),
    at: canonicalInstant(input.at, `${label}.at`),
    decisionRefs: captureStringList(input.decisionRefs, `${label}.decisionRefs`)
  };
  return deepFreeze({ ...body, ageCoordinateHash: contentHash(body) });
}

function captureRequest(value) {
  const input = captureRecord(value, 'lifeStageRequest', ['version', 'profileIds', 'ageCoordinates']);
  if (input.version !== LIFE_STAGE_MATCH_REQUEST_VERSION) fail('lifeStageRequest.version is unsupported');
  if (!Array.isArray(input.ageCoordinates) || Object.getPrototypeOf(input.ageCoordinates) !== Array.prototype
    || input.ageCoordinates.length === 0 || input.ageCoordinates.length > 16) {
    fail('lifeStageRequest.ageCoordinates must contain 1..16 plain-array candidates');
  }
  const profiles = selectLifeStageProfiles(input.profileIds);
  const ageCoordinates = [];
  for (let index = 0; index < input.ageCoordinates.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input.ageCoordinates, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`lifeStageRequest.ageCoordinates[${index}] must be own data`);
    ageCoordinates.push(captureAgeCoordinate(descriptor.value, `lifeStageRequest.ageCoordinates[${index}]`));
  }
  ageCoordinates.sort((left, right) => compareCodeUnits(left.coordinateId, right.coordinateId));
  if (new Set(ageCoordinates.map((coordinate) => coordinate.coordinateId)).size !== ageCoordinates.length) {
    fail('lifeStageRequest age coordinate IDs must be unique');
  }
  return { profiles, ageCoordinates };
}

function governingPillarRefs(slots) {
  return slots.map((slot) => `natal.${slot}`);
}

export function matchCapturedLifeStageCandidates(chart, requestValue, expectedAt = null) {
  const request = captureRequest(requestValue);
  if (expectedAt !== null) {
    const canonicalExpectedAt = canonicalInstant(expectedAt, 'lifeStage.expectedAt');
    if (request.ageCoordinates.some((coordinate) => coordinate.at !== canonicalExpectedAt)) {
      fail('life-stage age coordinates must be bound to the evaluated temporal instant');
    }
  }
  for (const coordinate of request.ageCoordinates) {
    if (coordinate.birthValidTimeRef !== chart.validTimeRef) {
      fail('life-stage age coordinate birthValidTimeRef must match the chart validTimeRef');
    }
  }

  const profileRefs = request.profiles.map((profile) => ({
    profileId: profile.profileId,
    profileHash: profile.profileHash,
    evidenceStatus: profile.evidenceStatus,
    sourceRefs: profile.sourceRefs
  }));
  const natalPillarOccurrences = Object.fromEntries(Object.entries(chart.pillars).map(([slot, pillar]) => [
    `natal.${slot}`,
    { occurrenceId: `natal.${slot}`, slot, pillar }
  ]));
  const candidates = [];
  const outsideProfileRange = [];
  for (const coordinate of request.ageCoordinates) {
    for (const profile of request.profiles) {
      if (coordinate.lifeYearOrdinal > profile.maximumLifeYearOrdinal) {
        outsideProfileRange.push({
          coordinateId: coordinate.coordinateId,
          ageCoordinateHash: coordinate.ageCoordinateHash,
          profileId: profile.profileId,
          profileHash: profile.profileHash,
          status: 'outside_profile_range'
        });
        continue;
      }
      for (const candidateModel of profile.models) {
        const segments = candidateModel.segments.filter((segment) =>
          segment.fromLifeYearOrdinal <= coordinate.lifeYearOrdinal
          && coordinate.lifeYearOrdinal < segment.untilLifeYearOrdinalExclusive);
        for (const segment of segments) {
          const body = {
            profileId: profile.profileId,
            profileHash: profile.profileHash,
            modelId: candidateModel.modelId,
            boundaryInterpretationId: candidateModel.boundaryInterpretationId,
            overlapPolicy: candidateModel.overlapPolicy,
            stageId: segment.stageId,
            stageRange: {
              fromLifeYearOrdinal: segment.fromLifeYearOrdinal,
              untilLifeYearOrdinalExclusive: segment.untilLifeYearOrdinalExclusive
            },
            coordinateId: coordinate.coordinateId,
            ageCoordinateHash: coordinate.ageCoordinateHash,
            lifeYearOrdinal: coordinate.lifeYearOrdinal,
            governingPillarOccurrenceRefs: governingPillarRefs(segment.governingNatalSlots),
            materialStatus: profile.materialStatus,
            evidenceStatus: profile.evidenceStatus,
            sourceRefs: profile.sourceRefs,
            utility: 'indeterminate',
            effectEligible: false
          };
          candidates.push({ ...body, candidateId: contentHash(body) });
        }
      }
    }
  }
  candidates.sort((left, right) => compareCodeUnits(left.candidateId, right.candidateId));
  outsideProfileRange.sort((left, right) => {
    const byCoordinate = compareCodeUnits(left.coordinateId, right.coordinateId);
    return byCoordinate === 0 ? compareCodeUnits(left.profileId, right.profileId) : byCoordinate;
  });
  const body = {
    version: LIFE_STAGE_MATCH_SET_VERSION,
    subjectRef: chart.subjectRef,
    snapshotRef: chart.snapshotRef,
    validTimeRef: chart.validTimeRef,
    chartIdentityHash: chart.chartIdentityHash,
    ageCoordinates: request.ageCoordinates,
    profileRefs,
    natalPillarOccurrences,
    candidates,
    outsideProfileRange,
    candidateCount: candidates.length,
    utility: 'indeterminate',
    effectEligible: false
  };
  return deepFreeze({ ...body, lifeStageMatchSetHash: contentHash(body) });
}

export function matchLifeStageCandidates(chartValue, requestValue) {
  return matchCapturedLifeStageCandidates(captureChartRecord(chartValue), requestValue);
}

export function buildLifeStageTimeline(profileIds = LIFE_STAGE_PROFILE_IDS) {
  const profiles = selectLifeStageProfiles(profileIds);
  const body = {
    version: 'bazi.life_stage_timeline.v1',
    profileRefs: profiles.map((profile) => ({
      profileId: profile.profileId,
      profileHash: profile.profileHash,
      maximumLifeYearOrdinal: profile.maximumLifeYearOrdinal,
      evidenceStatus: profile.evidenceStatus,
      sourceRefs: profile.sourceRefs,
      sourceBoundaryNotes: profile.sourceBoundaryNotes,
      models: profile.models
    })),
    candidateProfileCount: profiles.length,
    semantics: 'competing_profiles_never_averaged',
    utility: 'indeterminate',
    effectEligible: false
  };
  return deepFreeze({ ...body, timelineHash: contentHash(body) });
}
