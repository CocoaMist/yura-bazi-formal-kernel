import { CONDITION_VERDICTS } from '../algebra/condition.mjs';
import {
  captureExactDataRecord,
  enumValue,
  finiteNumber,
  requiredString,
  stringArray,
} from '../shared/assert.mjs';
import {
  BAZI_FOUNDATION_LANE_ID,
  namespaceOf,
} from '../systems/boundary.mjs';
import { compareCanonical } from '../shared/canonical.mjs';

export const CONTRIBUTION_VERSION = 'formal.causal_contribution.v1';
export const CONTRIBUTION_MODES = Object.freeze(['doctrinal_contribution', 'empirical_causal_effect']);
export const CONTRIBUTION_DIRECTIONS = Object.freeze(['supports', 'inhibits', 'neutral', 'conditional']);
export const CONTRIBUTION_BANDS = Object.freeze(['minimal', 'low', 'moderate', 'elevated', 'high', 'indeterminate']);
export const CALIBRATION_WITNESS_VERSION = 'formal.calibration_witness.v2';
export const IMPACT_SHARE_SCALE_PPM = 1_000_000;

const band = (value, field) => enumValue(value, CONTRIBUTION_BANDS, field);

function sha256Ref(value, field) {
  const normalized = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase sha256 content hash`);
  }
  return normalized;
}

export function buildCalibrationWitness(input = {}) {
  const value = captureExactDataRecord(input, [
    'version',
    'witnessId',
    'datasetRef',
    'datasetHash',
    'protocolRef',
    'protocolHash',
    'blindEvaluationRef',
    'populationRef',
    'system',
    'laneId',
    'eventType',
    'metricRef',
    'modelVersion',
  ], 'CalibrationWitness');
  if (value.version != null && value.version !== CALIBRATION_WITNESS_VERSION) {
    throw new TypeError(`CalibrationWitness.version must be ${CALIBRATION_WITNESS_VERSION}`);
  }
  const system = requiredString(value.system, 'CalibrationWitness.system');
  if (system !== 'bazi') throw new TypeError('CalibrationWitness.system must be bazi');
  const laneId = requiredString(value.laneId, 'CalibrationWitness.laneId');
  if (laneId !== BAZI_FOUNDATION_LANE_ID) {
    throw new TypeError(`CalibrationWitness.laneId must be ${BAZI_FOUNDATION_LANE_ID}`);
  }
  const metricRef = requiredString(value.metricRef, 'CalibrationWitness.metricRef');
  if (namespaceOf(metricRef) !== 'bazi') {
    throw new TypeError('CalibrationWitness.metricRef must be in the bazi namespace');
  }
  return Object.freeze({
    version: CALIBRATION_WITNESS_VERSION,
    authority: 'candidate',
    admissionStatus: 'candidate',
    witnessId: requiredString(value.witnessId, 'CalibrationWitness.witnessId'),
    datasetRef: requiredString(value.datasetRef, 'CalibrationWitness.datasetRef'),
    datasetHash: sha256Ref(value.datasetHash, 'CalibrationWitness.datasetHash'),
    protocolRef: requiredString(value.protocolRef, 'CalibrationWitness.protocolRef'),
    protocolHash: sha256Ref(value.protocolHash, 'CalibrationWitness.protocolHash'),
    blindEvaluationRef: requiredString(value.blindEvaluationRef, 'CalibrationWitness.blindEvaluationRef'),
    populationRef: requiredString(value.populationRef, 'CalibrationWitness.populationRef'),
    system,
    laneId,
    eventType: requiredString(value.eventType, 'CalibrationWitness.eventType'),
    metricRef,
    modelVersion: requiredString(value.modelVersion, 'CalibrationWitness.modelVersion'),
  });
}

export function buildCausalContribution({
  contributionId,
  mode = 'doctrinal_contribution',
  direction,
  strengthBand,
  importanceBand = 'indeterminate',
  relevanceBand,
  evidenceReliability,
  ruleApplicability,
  temporalPersistence = 'indeterminate',
  controllability = 'indeterminate',
  interventionFeasibility = 'indeterminate',
  interventionCost = 'indeterminate',
  responseElasticity = 'indeterminate',
  sourceRefs,
  calibrationWitness = null,
  coefficientPpm = null,
} = {}) {
  const normalizedMode = enumValue(mode, CONTRIBUTION_MODES, 'CausalContribution.mode');
  if (normalizedMode === 'doctrinal_contribution' && (coefficientPpm != null || calibrationWitness != null)) {
    throw new TypeError('doctrinal contribution may not claim a calibrated causal coefficient');
  }
  let witness = null;
  let coefficient = null;
  if (normalizedMode === 'empirical_causal_effect') {
    witness = buildCalibrationWitness(calibrationWitness);
    coefficient = finiteNumber(coefficientPpm, 'CausalContribution.coefficientPpm', {
      min: -IMPACT_SHARE_SCALE_PPM,
      max: IMPACT_SHARE_SCALE_PPM,
    });
    if (!Number.isInteger(coefficient)) throw new TypeError('CausalContribution.coefficientPpm must be an integer');
    throw new TypeError(
      'empirical causal effect requires a trusted internally admitted calibration witness; public witnesses remain candidate',
    );
  }
  const normalizedSourceRefs = stringArray(sourceRefs, 'CausalContribution.sourceRefs');
  if (!normalizedSourceRefs.length) {
    throw new TypeError('CausalContribution.sourceRefs requires at least one reference');
  }
  return Object.freeze({
    version: CONTRIBUTION_VERSION,
    contributionId: requiredString(contributionId, 'CausalContribution.contributionId'),
    mode: normalizedMode,
    direction: enumValue(direction, CONTRIBUTION_DIRECTIONS, 'CausalContribution.direction'),
    strengthBand: band(strengthBand, 'CausalContribution.strengthBand'),
    importanceBand: band(importanceBand, 'CausalContribution.importanceBand'),
    relevanceBand: band(relevanceBand, 'CausalContribution.relevanceBand'),
    evidenceReliability: band(evidenceReliability, 'CausalContribution.evidenceReliability'),
    ruleApplicability: enumValue(ruleApplicability, CONDITION_VERDICTS, 'CausalContribution.ruleApplicability'),
    temporalPersistence: band(temporalPersistence, 'CausalContribution.temporalPersistence'),
    controllability: band(controllability, 'CausalContribution.controllability'),
    interventionFeasibility: band(interventionFeasibility, 'CausalContribution.interventionFeasibility'),
    interventionCost: band(interventionCost, 'CausalContribution.interventionCost'),
    responseElasticity: band(responseElasticity, 'CausalContribution.responseElasticity'),
    sourceRefs: normalizedSourceRefs,
    calibrationWitness: witness,
    coefficientPpm: coefficient,
    causalClaim: false,
  });
}

export function modelInternalImpactSharesPpm(rows) {
  if (!Array.isArray(rows) || !rows.length) return Object.freeze([]);
  const normalized = rows.map((row, index) => {
    const contributionId = requiredString(row?.contributionId, `rows[${index}].contributionId`);
    const signedMagnitudePpm = finiteNumber(row?.signedMagnitudePpm, `rows[${index}].signedMagnitudePpm`, {
      min: -IMPACT_SHARE_SCALE_PPM,
      max: IMPACT_SHARE_SCALE_PPM,
    });
    if (!Number.isSafeInteger(signedMagnitudePpm)) throw new TypeError('signedMagnitudePpm must be a safe integer');
    return { contributionId, signedMagnitudePpm };
  });
  const ids = new Set(normalized.map((row) => row.contributionId));
  if (ids.size !== normalized.length) throw new TypeError('duplicate contributionId');
  const denominator = normalized.reduce((sum, row) => sum + Math.abs(row.signedMagnitudePpm), 0);
  if (denominator === 0) {
    return Object.freeze(normalized.map((row) => Object.freeze({
      contributionId: row.contributionId,
      impactSharePpm: null,
      status: 'indeterminate',
      causalClaim: false,
    })));
  }
  const working = normalized.map((row) => {
    const numerator = Math.abs(row.signedMagnitudePpm) * IMPACT_SHARE_SCALE_PPM;
    return {
      ...row,
      share: Math.floor(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remaining = IMPACT_SHARE_SCALE_PPM - working.reduce((sum, row) => sum + row.share, 0);
  const byRemainder = [...working].sort((left, right) => (
    right.remainder - left.remainder
    || compareCanonical(left.contributionId, right.contributionId)
  ));
  for (let index = 0; index < remaining; index += 1) byRemainder[index].share += 1;
  return Object.freeze(working
    .sort((left, right) => compareCanonical(left.contributionId, right.contributionId))
    .map((row) => Object.freeze({
      contributionId: row.contributionId,
      impactSharePpm: row.share,
      status: 'model_internal_attribution',
      causalClaim: false,
    })));
}
