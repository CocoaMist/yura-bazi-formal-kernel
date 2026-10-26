import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceAwareness,
  buildCalibrationWitness,
  buildCausalContribution,
  buildInterventionBranch,
  modelInternalImpactSharesPpm,
} from '../../src/index.mjs';

const doctrinal = {
  contributionId: 'contribution:1',
  mode: 'doctrinal_contribution',
  direction: 'supports',
  strengthBand: 'moderate',
  importanceBand: 'elevated',
  relevanceBand: 'high',
  evidenceReliability: 'moderate',
  ruleApplicability: 'satisfied',
  sourceRefs: ['rule:witness:1'],
};

test('doctrinal contribution cannot claim a numeric causal coefficient', () => {
  const value = buildCausalContribution(doctrinal);
  assert.equal(value.coefficientPpm, null);
  assert.equal(value.causalClaim, false);
  assert.throws(() => buildCausalContribution({ ...doctrinal, coefficientPpm: 500_000 }));
  assert.throws(() => buildCausalContribution({
    ...doctrinal,
    calibrationWitness: { witnessId: 'candidate' },
  }));
});

test('public calibration witnesses remain Bazi-lane candidates and empirical claims fail closed', () => {
  assert.throws(() => buildCausalContribution({
    ...doctrinal,
    mode: 'empirical_causal_effect',
    coefficientPpm: 100_000,
    calibrationWitness: { witnessId: 'only-a-string-equivalent' },
  }));
  const witnessInput = {
    witnessId: 'calibration:1',
    datasetRef: 'dataset:1',
    datasetHash: `sha256:${'a'.repeat(64)}`,
    protocolRef: 'protocol:blind:v1',
    protocolHash: `sha256:${'b'.repeat(64)}`,
    blindEvaluationRef: 'evaluation:1',
    populationRef: 'population:declared:1',
    system: 'bazi',
    laneId: 'bazi.foundation.v1',
    eventType: 'event:test',
    metricRef: 'bazi.test.pressure',
    modelVersion: 'model:1',
  };
  const witness = buildCalibrationWitness(witnessInput);
  assert.equal(witness.version, 'formal.calibration_witness.v2');
  assert.equal(witness.authority, 'candidate');
  assert.equal(witness.admissionStatus, 'candidate');
  assert.equal(witness.system, 'bazi');
  assert.equal(witness.laneId, 'bazi.foundation.v1');
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, version: 'formal.calibration_witness.v1' }),
    /version must be formal\.calibration_witness\.v2/,
  );
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, datasetHash: 'sha256:not-a-hash' }),
    /lowercase sha256 content hash/,
  );
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, protocolHash: `sha256:${'A'.repeat(64)}` }),
    /lowercase sha256 content hash/,
  );
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, admissionStatus: 'admitted' }),
    /unknown fields: admissionStatus/,
  );
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, system: 'liuyao' }),
    /system must be bazi/,
  );
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, laneId: 'bazi.school.v1' }),
    /laneId must be bazi\.foundation\.v1/,
  );
  assert.throws(
    () => buildCalibrationWitness({ ...witnessInput, metricRef: 'liuyao.test.pressure' }),
    /metricRef must be in the bazi namespace/,
  );
  assert.throws(() => buildCausalContribution({
    ...doctrinal,
    mode: 'empirical_causal_effect',
    coefficientPpm: 100_000,
    calibrationWitness: witnessInput,
  }), /trusted internally admitted calibration witness/);
  assert.throws(() => buildCausalContribution({
    ...doctrinal,
    mode: 'empirical_causal_effect',
    coefficientPpm: 100_000,
    calibrationWitness: { ...witnessInput, admissionStatus: 'admitted' },
  }), /unknown fields: admissionStatus/);
  for (const coefficientPpm of [Number.POSITIVE_INFINITY, 1_000_001]) {
    assert.throws(() => buildCausalContribution({
      ...doctrinal,
      mode: 'empirical_causal_effect',
      coefficientPpm,
      calibrationWitness: witnessInput,
    }), /finite number/);
  }
  assert.throws(() => buildCausalContribution({
    ...doctrinal,
    mode: 'empirical_causal_effect',
    coefficientPpm: 1.5,
    calibrationWitness: witnessInput,
  }), /must be an integer/);
  assert.throws(
    () => buildCausalContribution({ ...doctrinal, sourceRefs: [] }),
    /requires at least one reference/,
  );
});

test('model-internal impact shares use exact integer ppm and are not causal claims', () => {
  assert.deepEqual(modelInternalImpactSharesPpm(null), []);
  assert.deepEqual(modelInternalImpactSharesPpm([]), []);
  const shares = modelInternalImpactSharesPpm([
    { contributionId: 'a', signedMagnitudePpm: 1 },
    { contributionId: 'b', signedMagnitudePpm: -2 },
    { contributionId: 'c', signedMagnitudePpm: 3 },
  ]);
  assert.equal(shares.reduce((sum, row) => sum + row.impactSharePpm, 0), 1_000_000);
  assert.ok(shares.every((row) => row.causalClaim === false));
  const zero = modelInternalImpactSharesPpm([{ contributionId: 'z', signedMagnitudePpm: 0 }]);
  assert.equal(zero[0].impactSharePpm, null);
  assert.throws(
    () => modelInternalImpactSharesPpm([null]),
    /contributionId must be a non-empty string/,
  );
  assert.throws(
    () => modelInternalImpactSharesPpm([{ contributionId: 'a', signedMagnitudePpm: 0.5 }]),
    /safe integer/,
  );
  assert.throws(
    () => modelInternalImpactSharesPpm([
      { contributionId: 'duplicate', signedMagnitudePpm: 1 },
      { contributionId: 'duplicate', signedMagnitudePpm: 2 },
    ]),
    /duplicate contributionId/,
  );
  const tied = modelInternalImpactSharesPpm([
    { contributionId: 'b', signedMagnitudePpm: 1 },
    { contributionId: 'a', signedMagnitudePpm: 1 },
    { contributionId: 'c', signedMagnitudePpm: 1 },
  ]);
  assert.deepEqual(tied.map((row) => row.contributionId), ['a', 'b', 'c']);
  assert.equal(tied.reduce((sum, row) => sum + row.impactSharePpm, 0), 1_000_000);
});

test('awareness and intervention create a hypothetical branch, never natal mutation', () => {
  assert.equal(advanceAwareness('aware', 'planned'), 'planned');
  assert.throws(() => advanceAwareness('acted', 'aware'));
  const plannedInput = {
    branchId: 'branch:1',
    system: 'bazi',
    laneId: 'bazi.foundation.v1',
    runRef: 'run:1',
    subjectRef: 'subject:1',
    validTimeRef: 'time:future:1',
    hypothesisRef: 'hypothesis:1',
    awarenessState: 'planned',
    actionRef: 'action:1',
    controllabilityBand: 'moderate',
    feasibilityBand: 'elevated',
    costBand: 'low',
    expectedResponseBand: 'indeterminate',
    evidenceRefs: [],
  };
  const branch = buildInterventionBranch(plannedInput);
  assert.equal(branch.hypothetical, true);
  assert.equal(branch.causalClaim, false);
  assert.equal(branch.natalStateMutation, false);
  assert.throws(() => buildInterventionBranch({
    ...plannedInput,
    awarenessState: 'acted',
    actionRef: null,
  }), /requires actionRef/);
  assert.throws(() => buildInterventionBranch({ ...plannedInput, stateDelta: {} }), /unknown fields: stateDelta/);
  assert.throws(() => buildInterventionBranch({
    ...plannedInput,
    awarenessState: 'planned',
    observedOutcome: 'occurred',
  }), /requires acted or verified/);

  const observed = buildInterventionBranch({
    branchId: 'branch:observed:1',
    system: 'bazi',
    laneId: 'bazi.foundation.v1',
    runRef: 'run:1',
    subjectRef: 'subject:1',
    validTimeRef: 'time:future:1',
    hypothesisRef: 'hypothesis:1',
    awarenessState: 'verified',
    actionRef: 'action:1',
    controllabilityBand: 'moderate',
    feasibilityBand: 'elevated',
    costBand: 'low',
    expectedResponseBand: 'indeterminate',
    observedOutcome: 'occurred',
    evidenceRefs: ['evidence:observation:1'],
  });
  assert.equal(observed.hypothetical, false);
  assert.equal(observed.natalStateMutation, false);
});
