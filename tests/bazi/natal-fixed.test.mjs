import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNatalFixedBundleV1,
  assertNoForbiddenFixedFields,
  assertProfileScopedRawRelationMatches,
  buildNatalCompilationRequestV1,
  buildNatalFixedBundleV1,
  buildTemporalMatchIndexV1,
  captureNatalFixedStateV1,
  captureTemporalMatchIndexV1,
  compileNatalRequest,
  domainHashV1,
  matchTemporalOccurrences,
  projectProfileScopedRawRelationMatches,
  resolveSelectedRelationProfile,
} from '../../src/index.mjs';
import { BAZI_RELATION_PROFILE } from '../../src/bazi/relation-profile.mjs';
import { rawRelationTypeOf } from '../../src/bazi/raw-relation-matches.mjs';
import { cycleAnchorOf, natalFixedStateFromCompiledArtifact } from '../../src/bazi/natal-fixed-bundle.mjs';
import { SAMPLE_SNAPSHOT } from '../helpers.mjs';
import { temporalFactMaps } from '../../src/bazi/temporal-match-index.mjs';
import {
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  buildNatalCalendarArtifacts,
  resolveTimeRequest,
} from '../../capabilities/src/index.mjs';
import { RELEASE_CONTEXT } from '../helpers.mjs';
import { ACTIVE_PROFILE_ID, compileOne } from '../natal-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exampleInput = JSON.parse(readFileSync(
  new URL('../../examples/2000-07-19-beijing-male.input.json', import.meta.url),
  'utf8',
));
const selectedProfile = resolveSelectedRelationProfile(RELEASE_CONTEXT, ACTIVE_PROFILE_ID);

function compileBirth(input = exampleInput, args = []) {
  const run = spawnSync(process.execPath, ['tools/compile-birth.mjs', ...args], {
    cwd: root,
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return { bundle: JSON.parse(run.stdout), raw: run.stdout };
}

function fixedState(bundle) {
  const keys = Object.keys(bundle.fixedStatesByHash);
  assert.equal(keys.length, bundle.distinctFixedStateCount);
  return bundle.fixedStatesByHash[keys[0]];
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
}

function rehash(value, hashField, domain) {
  const captured = structuredClone(value);
  delete captured[hashField];
  captured[hashField] = domainHashV1(domain, captured);
  return captured;
}

async function compileBirthParts(input = exampleInput) {
  const inputFactHash = domainHashV1('bazi.birth_input_fact.v1', input.birth);
  const resolutions = [];
  for (const clockPolicy of input.clockPolicies) {
    resolutions.push(await resolveTimeRequest({
      version: 'bazi.time_request.v1',
      mode: 'instant',
      calendar: input.birth.calendar,
      timeZoneId: input.birth.timeZoneId,
      location: input.birth.location,
      solarTime: clockPolicy === 'civil'
        ? { mode: 'civil' }
        : {
          mode: 'true_solar',
          algorithmRef: REFERENCE_CALENDAR_PROFILE.trueSolarAlgorithmId,
        },
      boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
      input: input.birth.input,
    }, REFERENCE_CALENDAR_PROVIDER));
  }
  const calendarArtifacts = buildNatalCalendarArtifacts({
    version: 'bazi.natal_calendar_artifacts_request.v1',
    inputFactHash,
    subjectRef: input.subjectRef,
    validTimeRef: `birth-input:${inputFactHash}`,
    traditionalSexClass: input.birth.traditionalSexClass,
    precisionPolicy: input.precisionPolicy,
    resolutions,
  });
  const compilationRequest = buildNatalCompilationRequestV1({
    version: 'bazi.natal_compilation_request.v1',
    requestSchemaVersion: 'bazi.natal_compilation_request.schema.v1',
    candidateSnapshotSetHash: calendarArtifacts.candidateSnapshotSet.candidateSnapshotSetHash,
    calendarDecisionTraceHash: calendarArtifacts.calendarDecisionTrace.calendarDecisionTraceHash,
    releaseManifestHash: RELEASE_CONTEXT.releaseManifestHash,
    activeProfileId: ACTIVE_PROFILE_ID,
  });
  const compilationBatch = compileNatalRequest(
    compilationRequest,
    calendarArtifacts.candidateSnapshotSet,
    calendarArtifacts.calendarDecisionTrace,
    RELEASE_CONTEXT,
  );
  return { input, resolutions, calendarArtifacts, compilationRequest, compilationBatch };
}

test('NatalFixedBundle deduplicates converged calendar paths without losing lineage', () => {
  const first = compileBirth();
  const second = compileBirth();
  assert.equal(first.raw, second.raw);
  const bundle = first.bundle;
  assert.equal(assertNatalFixedBundleV1(bundle), bundle);
  assert.equal(bundle.pathCount, 2);
  assert.equal(bundle.distinctFixedStateCount, 1);
  assert.equal(bundle.audit.canonicalFactGraphPhysicalCopies, 1);
  assert.equal(bundle.calendarResolution.candidatePaths.length, 2);
  assert.notEqual(bundle.pathBindings[0].candidateId, bundle.pathBindings[1].candidateId);
  assert.equal(bundle.pathBindings[0].fixedStateRef, bundle.pathBindings[1].fixedStateRef);
  assert.ok(bundle.pathBindings.every((binding) =>
    binding.sourceProjectionDerivations.length === 4
    && binding.sourceProjectionDerivations.every((derivation) =>
      derivation.derivationKind === 'source_projection'
      && derivation.sourceArtifactRef === binding.candidateSnapshotHash
      && derivation.sourcePath.startsWith('$.snapshot.pillars.'))));

  const state = fixedState(bundle);
  assert.deepEqual(state.coordinates.pillars, {
    year: { stemId: 'geng', branchId: 'chen' },
    month: { stemId: 'gui', branchId: 'wei' },
    day: { stemId: 'wu', branchId: 'yin' },
    hour: { stemId: 'geng', branchId: 'shen' },
  });
  assert.equal(state.coordinates.pillarCode24, 14_738_640);
  assert.equal(state.coordinates.index19, 143_456);
  assert.equal(state.canonicalFactGraph.factCount, 65);
  for (const type of [
    'stem_occurrence', 'branch_occurrence', 'hidden_stem_occurrence',
    'element_polarity_assignment', 'day_master', 'ten_god_relation', 'growth_stage',
  ]) assert.ok(state.canonicalFactGraph.facts.some((fact) => fact.factType === type));
  assert.equal(JSON.stringify(bundle).match(/"version":"bazi.canonical_fact_graph.v4"/g)?.length, 1);
  assertNoForbiddenFixedFields(bundle);

  const civilTrace = bundle.calendarResolution.candidatePaths[0].decisionPath;
  const solarTrace = bundle.calendarResolution.candidatePaths[1].decisionPath;
  assert.equal(Number.isSafeInteger(civilTrace.input.utcInstantMs), true);
  assert.equal(Number.isSafeInteger(solarTrace.decisions.effectiveClockMs), true);
  assert.equal(Number.isSafeInteger(solarTrace.decisions.solarCorrectionMs), true);
  assert.notEqual(civilTrace.decisions.effectiveClockMs, solarTrace.decisions.effectiveClockMs);
  assert.equal(state.coordinates.cycleAnchors.day.calculationIdentity,
    'bazi.sexagenary_xun_void.cycle_anchor.v1');
  assert.equal(state.coordinates.cycleAnchors.day.voidBranchIds.length, 2);

  const reordered = reverseKeys(state);
  assert.equal(captureNatalFixedStateV1(reordered).fixedStateHash, state.fixedStateHash);
  assert.equal(captureTemporalMatchIndexV1(reverseKeys(state.temporalMatchIndex)).temporalMatchIndexHash,
    state.temporalMatchIndex.temporalMatchIndexHash);

  const differentSubject = structuredClone(exampleInput);
  differentSubject.subjectRef = 'subject:different-calendar-provenance';
  assert.equal(fixedState(compileBirth(differentSubject).bundle).fixedStateHash, state.fixedStateHash);
  const differentSex = structuredClone(exampleInput);
  differentSex.birth.traditionalSexClass = 'female';
  assert.equal(fixedState(compileBirth(differentSex).bundle).fixedStateHash, state.fixedStateHash);
});

test('raw natal relation matches retain membership and correspondence but no evaluation fields', () => {
  const state = fixedState(compileBirth().bundle);
  const matches = state.profileScopedRawRelationMatches.matches;
  assert.equal(matches.length, 6);
  const byRule = new Map(matches.map((match) => [match.relationRuleId, match]));
  const stemCombination = byRule.get('bazi.relation_rule.stem_five_combination.v1');
  assert.equal(stemCombination.membership, 'complete_membership');
  assert.equal(stemCombination.traditionalCorrespondence.elementId, 'fire');
  assert.equal(stemCombination.traditionalCorrespondence.semantics,
    'relation_rule_correspondence_only_not_transformation');
  assert.equal(byRule.get('bazi.relation_rule.branch_clash.v1').membership, 'complete_membership');
  const punishment = byRule.get('bazi.relation_rule.branch_punishment.v1');
  assert.equal(punishment.directionality, 'directed');
  assert.deepEqual(punishment.roleBindings.map((binding) => binding.occurrenceRef), [
    'pillar.hour.branch', 'pillar.day.branch',
  ]);
  for (const [ruleId, missing] of [
    ['bazi.relation_rule.three_meeting.three_meeting_wood.v1', 'mao'],
    ['bazi.relation_rule.three_harmony.three_harmony_water.v1', 'zi'],
    ['bazi.relation_rule.punishment_group.punishment_yin_si_shen.v1', 'si'],
  ]) {
    const match = byRule.get(ruleId);
    assert.equal(match.membership, 'partial_membership');
    assert.deepEqual(match.missingRequirements.map((item) => item.requiredSymbol), [missing]);
  }
});

test('TemporalMatchIndex covers 10 stems, 12 branches and 60 reference-only pillars', () => {
  const state = fixedState(compileBirth().bundle);
  const index = state.temporalMatchIndex;
  assert.equal(Object.keys(index.byStem).length, 10);
  assert.equal(Object.keys(index.byBranch).length, 12);
  assert.equal(index.byPillar60.length, 60);
  for (const entry of Object.values(index.byStem)) {
    assert.equal(entry.elementRelations.length, 4);
    assert.ok(entry.sourceFactRefs.length >= 5);
    assert.equal(entry.selectedRelationProfileHash, index.selectedRelationProfileHash);
    assert.match(entry.contentHash, /^sha256:/);
  }
  for (const entry of Object.values(index.byBranch)) {
    assert.equal(entry.elementRelations.length, 4);
    assert.ok(entry.sourceFactRefs.length >= 5);
    assert.equal(entry.selectedRelationProfileHash, index.selectedRelationProfileHash);
    assert.match(entry.contentHash, /^sha256:/);
    assert.ok(entry.hiddenStems.every((hidden) =>
      hidden.orderSemantics === 'profile_table_order_only_no_weight'));
  }
  assert.ok(index.byBranch.mao.groupMatches.some((match) =>
    match.relationRuleId === 'bazi.relation_rule.three_meeting.three_meeting_wood.v1'
    && match.membership === 'complete_membership'));
  assert.ok(index.byBranch.zi.groupMatches.some((match) =>
    match.relationRuleId === 'bazi.relation_rule.three_harmony.three_harmony_water.v1'
    && match.membership === 'complete_membership'));
  assert.ok(index.byBranch.si.groupMatches.some((match) =>
    match.relationRuleId === 'bazi.relation_rule.punishment_group.punishment_yin_si_shen.v1'
    && match.membership === 'complete_membership'));
  for (const pillar of index.byPillar60) {
    assert.equal(pillar.stemIndexRef, `byStem.${pillar.stemId}`);
    assert.equal(pillar.branchIndexRef, `byBranch.${pillar.branchId}`);
    assert.equal('elementRelations' in pillar, false);
  }

  const natalBranches = Object.values(state.coordinates.pillars).map((pillar) => pillar.branchId);
  for (const [branchId, entry] of Object.entries(index.byBranch)) {
    let expected = 0;
    for (const natalBranchId of natalBranches) {
      for (const [relationId, pairs] of Object.entries(BAZI_RELATION_PROFILE.branchPairCandidates)) {
        expected += pairs.some(([left, right]) => relationId === 'punishment'
          ? (left === branchId && right === natalBranchId)
            || (left === natalBranchId && right === branchId)
          : (left === branchId && right === natalBranchId)
            || (left === natalBranchId && right === branchId)) ? 1 : 0;
      }
    }
    assert.equal(entry.pairMatches.length, expected, `direct pair enumeration drift for ${branchId}`);
  }
});

test('temporal matcher is index-backed, occurrence-bound and exhaustive across symbols', () => {
  const ziState = natalFixedStateFromCompiledArtifact(compileOne(SAMPLE_SNAPSHOT), selectedProfile, RELEASE_CONTEXT);
  const reciprocal = matchTemporalOccurrences(ziState, [{
    occurrenceId: 'temporal:reciprocal:mao', layer: 'year', slot: 'branch',
    branchId: 'mao', sourceTimeRef: 'time:reciprocal:mao',
  }], selectedProfile).matches.filter(m => m.relationRuleId === 'bazi.relation_rule.branch_punishment.v1');
  assert.equal(reciprocal.length, 6, 'three natal Zi occurrences each require both directions');
  const state = fixedState(compileBirth().bundle);
  const mao = matchTemporalOccurrences(state, [{
    occurrenceId: 'temporal:test:mao', layer: 'year', slot: 'branch',
    branchId: 'mao', sourceTimeRef: 'time:test:mao',
  }], selectedProfile);
  assert.ok(mao.matches.some((match) =>
    match.relationRuleId === 'bazi.relation_rule.three_meeting.three_meeting_wood.v1'
    && match.membership === 'complete_membership'
    && match.temporalOccurrenceRefs[0] === 'temporal:test:mao'));
  assertNoForbiddenFixedFields(mao);

  const stems = Object.keys(state.temporalMatchIndex.byStem).map((stemId, index) => ({
    occurrenceId: `temporal:stem:${index}`, layer: 'year', slot: 'stem', stemId,
    sourceTimeRef: `time:stem:${index}`,
  }));
  const stemMatches = matchTemporalOccurrences(state, stems, selectedProfile);
  assert.ok(stemMatches.matchCount >= 40);
  const branches = Object.keys(state.temporalMatchIndex.byBranch).map((branchId, index) => ({
    occurrenceId: `temporal:branch:${index}`, layer: 'year', slot: 'branch', branchId,
    sourceTimeRef: `time:branch:${index}`,
  }));
  const branchMatches = matchTemporalOccurrences(state, branches, selectedProfile);
  assert.ok(branchMatches.matchCount >= 48);

  for (const pillar of state.temporalMatchIndex.byPillar60) {
    const result = matchTemporalOccurrences(state, [
      {
        occurrenceId: `temporal:pillar:${pillar.sexagenaryIndex}:stem`,
        layer: 'day', slot: 'stem', stemId: pillar.stemId,
        sourceTimeRef: `time:pillar:${pillar.sexagenaryIndex}`,
      },
      {
        occurrenceId: `temporal:pillar:${pillar.sexagenaryIndex}:branch`,
        layer: 'day', slot: 'branch', branchId: pillar.branchId,
        sourceTimeRef: `time:pillar:${pillar.sexagenaryIndex}`,
      },
    ], selectedProfile);
    assert.equal(result.version, 'bazi.raw_structural_match_set.v1');
    assert.ok(result.matchCount >= 8);
  }

  assert.throws(() => matchTemporalOccurrences({}, [], selectedProfile), /NatalFixedStateV1/);
  assert.throws(() => matchTemporalOccurrences(state, {}, selectedProfile), /must be an array/);
  assert.throws(() => matchTemporalOccurrences(state, [{
    occurrenceId: 'bad', layer: 'day', slot: 'stem', stemId: 'jia', branchId: 'zi', sourceTimeRef: 't',
  }], selectedProfile), /exactly one/);
  assert.throws(() => matchTemporalOccurrences(state, [{
    occurrenceId: 'bad', layer: 'day', slot: 'stem', stemId: 'void', sourceTimeRef: 't',
  }], selectedProfile), /unsupported/);
  assert.throws(() => matchTemporalOccurrences(state, [
    { occurrenceId: 'duplicate', layer: 'day', slot: 'stem', stemId: 'jia', sourceTimeRef: 't' },
    { occurrenceId: 'duplicate', layer: 'day', slot: 'branch', branchId: 'zi', sourceTimeRef: 't' },
  ], selectedProfile), /unique/);
  assert.throws(() => matchTemporalOccurrences(state, [], { ...selectedProfile }), /must be produced/);
});

test('a factory-compiled natal artifact can enter occurrence matching without a calendar bundle', () => {
  const artifact = compileOne(SAMPLE_SNAPSHOT);
  const state = natalFixedStateFromCompiledArtifact(artifact, selectedProfile, RELEASE_CONTEXT);
  const captured = captureNatalFixedStateV1(state);
  assert.equal(captured.fixedStateHash, state.fixedStateHash);
  assert.equal(captured.coordinates.pillarCode24, artifact.pillarCode24);
  const hepan = matchTemporalOccurrences(state, [
    {
      occurrenceId: 'temporal:fixture:year:stem',
      layer: 'year',
      slot: 'stem',
      stemId: SAMPLE_SNAPSHOT.pillars.year.stemId,
      sourceTimeRef: 'time:fixture:year',
    },
    {
      occurrenceId: 'temporal:fixture:year:branch',
      layer: 'year',
      slot: 'branch',
      branchId: SAMPLE_SNAPSHOT.pillars.year.branchId,
      sourceTimeRef: 'time:fixture:year',
    },
  ], selectedProfile);
  assert.ok(hepan.matchCount > 0);
  assert.equal(hepan.fixedStateHash, state.fixedStateHash);
  assert.equal(hepan.temporalOccurrenceCount, 2);
});

test('critical civil and true-solar paths split into two fixed states when pillars differ', () => {
  const boundary = structuredClone(exampleInput);
  boundary.birth.input.local = '2000-07-19T15:00:00';
  const bundle = compileBirth(boundary).bundle;
  assert.equal(bundle.pathCount, 2);
  assert.equal(bundle.distinctFixedStateCount, 2);
  assert.notEqual(bundle.pathBindings[0].fixedStateRef, bundle.pathBindings[1].fixedStateRef);
});

test('fixed bundle builder fails closed when release, profile or path cardinality drifts', async () => {
  const parts = await compileBirthParts();
  const base = {
    input: parts.input,
    calendarArtifacts: parts.calendarArtifacts,
    calendarResolutions: parts.resolutions,
    compilationRequest: parts.compilationRequest,
    compilationBatch: parts.compilationBatch,
    releaseContext: RELEASE_CONTEXT,
    selectedRelationProfile: selectedProfile,
  };
  const built = buildNatalFixedBundleV1(base);
  assert.equal(assertNatalFixedBundleV1(built), built);
  assert.throws(() => buildNatalFixedBundleV1({
    ...base,
    compilationRequest: { ...parts.compilationRequest, activeProfileId: 'profile:drift' },
  }), /share admitted release and profile/);
  assert.throws(() => buildNatalFixedBundleV1({
    ...base,
    calendarResolutions: parts.resolutions.slice(1),
  }), /counts differ/);
  assert.throws(() => buildNatalFixedBundleV1({
    ...base,
    calendarResolutions: {},
  }), /counts differ/);
  assert.throws(() => buildNatalFixedBundleV1({
    ...base,
    compilationBatch: { ...parts.compilationBatch, resultCount: 1 },
  }), /counts differ/);
  assert.throws(() => buildNatalFixedBundleV1({
    ...base,
    compilationBatch: { ...parts.compilationBatch, releaseManifestHash: `sha256:${'7'.repeat(64)}` },
  }), /share admitted release and profile/);

  const failedBatch = structuredClone(parts.compilationBatch);
  for (const result of failedBatch.results) result.status = 'validation_failed';
  const failedBundle = buildNatalFixedBundleV1({ ...base, compilationBatch: failedBatch });
  assert.equal(failedBundle.distinctFixedStateCount, 0);
  assert.ok(failedBundle.pathBindings.every((binding) =>
    binding.fixedStateRef === null && binding.sourceProjectionDerivations.length === 0));
});

test('fixed validators reject hash, closure, profile and forbidden-field drift', () => {
  const bundle = compileBirth().bundle;
  const state = fixedState(bundle);
  const tamper = (mutate) => {
    const value = structuredClone(bundle);
    mutate(value);
    assert.throws(() => assertNatalFixedBundleV1(value));
  };
  const semanticTamper = (mutate, pattern) => {
    const value = structuredClone(bundle);
    mutate(value);
    assert.throws(() => assertNatalFixedBundleV1(rehash(
      value,
      'bundleHash',
      'bazi.natal_fixed_bundle.v1',
    )), pattern);
  };
  tamper((value) => { value.version = 'bad'; });
  tamper((value) => { value.bundleHash = `sha256:${'0'.repeat(64)}`; });
  tamper((value) => { value.distinctFixedStateCount = 2; });
  tamper((value) => { value.pathBindings[0].fixedStateRef = `sha256:${'1'.repeat(64)}`; });
  tamper((value) => { value.pathBindings[0].sourceProjectionDerivations = []; });
  tamper((value) => { value.audit.score = 1; });
  semanticTamper((value) => { value.distinctFixedStateCount += 1; }, /distinctFixedStateCount/);
  semanticTamper((value) => { value.pathCount += 1; }, /path binding closure/);
  semanticTamper((value) => {
    value.pathBindings[0].fixedStateRef = `sha256:${'5'.repeat(64)}`;
  }, /path binding closure/);
  semanticTamper((value) => {
    value.pathBindings[0].sourceProjectionDerivations = [];
  }, /root source projection closure/);
  for (const mutateDerivation of [
    (derivation) => { derivation.derivationKind = 'wrong'; },
    (derivation) => { derivation.sourceArtifactRef = 'snapshot:wrong'; },
    (derivation) => { derivation.targetFactRef = 'fact:missing'; },
  ]) {
    semanticTamper((value) => mutateDerivation(
      value.pathBindings[0].sourceProjectionDerivations[0],
    ), /root source projection closure/);
  }
  semanticTamper((value) => {
    const [stateKey] = Object.keys(value.fixedStatesByHash);
    value.fixedStatesByHash[`sha256:${'6'.repeat(64)}`] = value.fixedStatesByHash[stateKey];
    delete value.fixedStatesByHash[stateKey];
  }, /key mismatch/);
  semanticTamper((value) => {
    value.pathBindings[0].pathBindingHash = `sha256:${'8'.repeat(64)}`;
  }, /pathBindingHash mismatch/);
  semanticTamper((value) => {
    const binding = value.pathBindings[0];
    binding.fixedStateRef = null;
    binding.sourceProjectionDerivations = [];
    value.pathBindings[0] = rehash(binding, 'pathBindingHash', 'bazi.natal_fixed_path_binding.v1');
  }, /status and fixedStateRef differ/);
  semanticTamper((value) => {
    const binding = value.pathBindings[0];
    binding.sourceProjectionDerivations[0].derivationHash = `sha256:${'9'.repeat(64)}`;
    value.pathBindings[0] = rehash(binding, 'pathBindingHash', 'bazi.natal_fixed_path_binding.v1');
  }, /derivation hash or target mismatch/);
  semanticTamper((value) => {
    const binding = value.pathBindings[0];
    const derivation = binding.sourceProjectionDerivations[0];
    derivation.targetFixedStateRef = `sha256:${'a'.repeat(64)}`;
    binding.sourceProjectionDerivations[0] = rehash(
      derivation,
      'derivationHash',
      'bazi.source_projection_derivation.v1',
    );
    value.pathBindings[0] = rehash(binding, 'pathBindingHash', 'bazi.natal_fixed_path_binding.v1');
  }, /derivation hash or target mismatch/);

  const stateVersionDrift = structuredClone(state);
  stateVersionDrift.version = 'bad';
  assert.throws(() => captureNatalFixedStateV1(stateVersionDrift), /unsupported/);
  const stateHashDrift = structuredClone(state);
  stateHashDrift.fixedStateHash = `sha256:${'2'.repeat(64)}`;
  assert.throws(() => captureNatalFixedStateV1(stateHashDrift), /hash mismatch/);

  const danglingFact = structuredClone(state);
  danglingFact.canonicalFactGraph.facts.find((fact) => fact.inputFactRefs.length > 0)
    .inputFactRefs[0] = 'fact:missing';
  Object.assign(danglingFact, rehash(danglingFact, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(danglingFact), /dangling factRef/);

  const danglingDerivation = structuredClone(state);
  danglingDerivation.canonicalFactGraph.facts.find((fact) => fact.derivationRefs.length > 0)
    .derivationRefs[0] = 'sha256:missing';
  Object.assign(danglingDerivation,
    rehash(danglingDerivation, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(danglingDerivation), /dangling derivationRef/);

  const danglingRawSupport = structuredClone(state);
  const danglingMatch = danglingRawSupport.profileScopedRawRelationMatches.matches[0];
  danglingMatch.supportingFactRefs[0] = 'fact:missing';
  Object.assign(danglingMatch, rehash(danglingMatch, 'contentHash', 'bazi.raw_relation_match.v1'));
  danglingRawSupport.profileScopedRawRelationMatches = rehash(
    danglingRawSupport.profileScopedRawRelationMatches,
    'rawRelationMatchSetHash',
    'bazi.profile_scoped_raw_relation_matches.v1',
  );
  danglingRawSupport.temporalMatchIndex.rawRelationMatchSetHash =
    danglingRawSupport.profileScopedRawRelationMatches.rawRelationMatchSetHash;
  danglingRawSupport.temporalMatchIndex = rehash(
    danglingRawSupport.temporalMatchIndex,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  );
  Object.assign(danglingRawSupport,
    rehash(danglingRawSupport, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(danglingRawSupport), /dangling factRef/);

  const danglingIndexSupport = structuredClone(state);
  danglingIndexSupport.temporalMatchIndex.sourceFactRefs[0] = 'fact:missing';
  danglingIndexSupport.temporalMatchIndex = rehash(
    danglingIndexSupport.temporalMatchIndex,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  );
  Object.assign(danglingIndexSupport,
    rehash(danglingIndexSupport, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(danglingIndexSupport), /dangling factRef/);

  const danglingDayMasterRef = structuredClone(state);
  const jiaIndexEntry = danglingDayMasterRef.temporalMatchIndex.byStem.jia;
  jiaIndexEntry.relativeToDayMaster.dayMasterFactRef = 'fact:missing';
  danglingDayMasterRef.temporalMatchIndex.byStem.jia = rehash(
    jiaIndexEntry,
    'contentHash',
    'bazi.temporal_stem_index_entry.v1',
  );
  danglingDayMasterRef.temporalMatchIndex = rehash(
    danglingDayMasterRef.temporalMatchIndex,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  );
  Object.assign(danglingDayMasterRef,
    rehash(danglingDayMasterRef, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(danglingDayMasterRef), /dangling factRef/);

  const rawCardinalityDrift = structuredClone(state);
  rawCardinalityDrift.profileScopedRawRelationMatches.matchCount += 1;
  rawCardinalityDrift.profileScopedRawRelationMatches = rehash(
    rawCardinalityDrift.profileScopedRawRelationMatches,
    'rawRelationMatchSetHash',
    'bazi.profile_scoped_raw_relation_matches.v1',
  );
  Object.assign(rawCardinalityDrift,
    rehash(rawCardinalityDrift, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(rawCardinalityDrift), /cardinality/);

  const rawSetHashDrift = structuredClone(state);
  rawSetHashDrift.profileScopedRawRelationMatches.rawRelationMatchSetHash =
    `sha256:${'b'.repeat(64)}`;
  Object.assign(rawSetHashDrift,
    rehash(rawSetHashDrift, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(rawSetHashDrift), /match set hash mismatch/);

  const rawNestedHashDrift = structuredClone(state);
  rawNestedHashDrift.profileScopedRawRelationMatches.matches[0].contentHash =
    `sha256:${'c'.repeat(64)}`;
  rawNestedHashDrift.profileScopedRawRelationMatches = rehash(
    rawNestedHashDrift.profileScopedRawRelationMatches,
    'rawRelationMatchSetHash',
    'bazi.profile_scoped_raw_relation_matches.v1',
  );
  rawNestedHashDrift.temporalMatchIndex.rawRelationMatchSetHash =
    rawNestedHashDrift.profileScopedRawRelationMatches.rawRelationMatchSetHash;
  rawNestedHashDrift.temporalMatchIndex = rehash(
    rawNestedHashDrift.temporalMatchIndex,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  );
  Object.assign(rawNestedHashDrift,
    rehash(rawNestedHashDrift, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(rawNestedHashDrift), /nested contentHash mismatch/);

  const identityDrift = structuredClone(state);
  identityDrift.temporalMatchIndex.canonicalFactGraphHash = `sha256:${'d'.repeat(64)}`;
  identityDrift.temporalMatchIndex = rehash(
    identityDrift.temporalMatchIndex,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  );
  Object.assign(identityDrift, rehash(identityDrift, 'fixedStateHash', 'bazi.natal_fixed_state.v1'));
  assert.throws(() => captureNatalFixedStateV1(identityDrift), /identity differ/);

  const indexVersionDrift = structuredClone(state.temporalMatchIndex);
  indexVersionDrift.version = 'bad';
  assert.throws(() => captureTemporalMatchIndexV1(indexVersionDrift), /unsupported/);
  const indexHashDrift = structuredClone(state.temporalMatchIndex);
  indexHashDrift.temporalMatchIndexHash = `sha256:${'3'.repeat(64)}`;
  assert.throws(() => captureTemporalMatchIndexV1(indexHashDrift), /hash mismatch/);
  const indexCoverageDrift = structuredClone(state.temporalMatchIndex);
  delete indexCoverageDrift.byStem.jia;
  assert.throws(() => captureTemporalMatchIndexV1(rehash(
    indexCoverageDrift,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  )), /coverage/);
  for (const mutateCoverage of [
    (value) => { delete value.byBranch.zi; },
    (value) => { value.byPillar60.pop(); },
  ]) {
    const drift = structuredClone(state.temporalMatchIndex);
    mutateCoverage(drift);
    assert.throws(() => captureTemporalMatchIndexV1(rehash(
      drift,
      'temporalMatchIndexHash',
      'bazi.temporal_match_index.v1',
    )), /coverage/);
  }

  const profileDriftState = structuredClone(state);
  profileDriftState.temporalMatchIndex.selectedRelationProfileHash = `sha256:${'4'.repeat(64)}`;
  profileDriftState.temporalMatchIndex = rehash(
    profileDriftState.temporalMatchIndex,
    'temporalMatchIndexHash',
    'bazi.temporal_match_index.v1',
  );
  assert.throws(() => matchTemporalOccurrences(profileDriftState, [], selectedProfile),
    /RelationProfile differ/);
  assert.throws(() => matchTemporalOccurrences({
    version: 'bazi.natal_fixed_state.v1',
  }, [], selectedProfile), /content-addressed/);
  assert.throws(() => matchTemporalOccurrences(state, [null], selectedProfile), /exactly one/);

  assert.throws(() => assertProfileScopedRawRelationMatches({}), /factory-produced/);
  assert.throws(() => assertNoForbiddenFixedFields({ activationStatus: 'x' }), /forbidden/);
  assert.throws(() => rawRelationTypeOf('unsupported_candidate'), /unsupported/);
  assert.throws(() => cycleAnchorOf({ stemId: 'jia', branchId: 'chou' }, 'test'),
    /invalid sexagenary/);
  assert.throws(() => temporalFactMaps({ facts: [] }), /lacks DayMasterFact/);

  const artifact = compileOne({
    version: 'bazi.chart_snapshot.v2',
    snapshotId: 'snapshot:raw-projection-test',
    subjectRef: 'subject:raw-projection-test',
    validTimeRef: 'time:raw-projection-test',
    traditionalSexClass: 'unknown',
    provenanceRef: 'test:raw-projection',
    pillars: state.coordinates.pillars,
  });
  const projected = projectProfileScopedRawRelationMatches(artifact.profileScopedStructuralCandidateSet);
  assert.equal(assertProfileScopedRawRelationMatches(projected), projected);
  assert.equal(projected.matches.every((match) =>
    ['complete_membership', 'partial_membership'].includes(match.membership)), true);
  const { contentHash, ...matchBody } = projected.matches[0];
  assert.equal(contentHash, domainHashV1('bazi.raw_relation_match.v1', matchBody));

  const otherArtifact = compileOne({
    version: 'bazi.chart_snapshot.v2',
    snapshotId: 'snapshot:index-mismatch-test',
    subjectRef: 'subject:index-mismatch-test',
    validTimeRef: 'time:index-mismatch-test',
    traditionalSexClass: 'unknown',
    provenanceRef: 'test:index-mismatch',
    pillars: {
      year: { stemId: 'jia', branchId: 'zi' },
      month: { stemId: 'bing', branchId: 'yin' },
      day: { stemId: 'jia', branchId: 'zi' },
      hour: { stemId: 'wu', branchId: 'chen' },
    },
  });
  assert.throws(() => buildTemporalMatchIndexV1({
    canonicalFactGraph: otherArtifact.canonicalFactGraph,
    structuralMaterials: artifact.structuralMaterials,
    profileScopedRawRelationMatches: projected,
    selectedRelationProfile: selectedProfile,
  }), /do not share graph and profile/);
  const otherRawMatches = projectProfileScopedRawRelationMatches(
    otherArtifact.profileScopedStructuralCandidateSet,
  );
  const otherIndex = buildTemporalMatchIndexV1({
    canonicalFactGraph: otherArtifact.canonicalFactGraph,
    structuralMaterials: otherArtifact.structuralMaterials,
    profileScopedRawRelationMatches: otherRawMatches,
    selectedRelationProfile: selectedProfile,
  });
  assert.equal(captureTemporalMatchIndexV1(otherIndex), otherIndex);
});
