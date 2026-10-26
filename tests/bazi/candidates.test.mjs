import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveProfileScopedStructuralCandidateSet,
  expectedHourStemId,
  expectedMonthStemId,
} from '../../src/index.mjs';
import { HYPEREDGE_PILLARS, RELEASE_CONTEXT } from '../helpers.mjs';
import { ACTIVE_PROFILE_ID } from '../natal-fixtures.mjs';
import { compileOne } from '../natal-fixtures.mjs';
import {
  assertProfileScopedStructuralCandidateSet,
  assertSelfPunishmentCandidatePolicy,
  buildProfileScopedStructuralCandidateSet,
} from '../../src/bazi/candidates.mjs';
import { resolveSelectedRelationProfile } from '../../src/release/manifest.mjs';
import { SAMPLE_SNAPSHOT } from '../helpers.mjs';

const deriveCandidates = (pillars) => deriveProfileScopedStructuralCandidateSet(
  pillars,
  RELEASE_CONTEXT,
  ACTIVE_PROFILE_ID,
);

const BRANCH_ORDER = ['zi', 'chou', 'yin', 'mao', 'chen', 'si', 'wu', 'wei', 'shen', 'you', 'xu', 'hai'];
function pillarsForBranches([yearBranch, monthBranch, dayBranch, hourBranch]) {
  const yearStem = BRANCH_ORDER.indexOf(yearBranch) % 2 === 0 ? 'jia' : 'yi';
  const dayStem = BRANCH_ORDER.indexOf(dayBranch) % 2 === 0 ? 'jia' : 'yi';
  return {
    year: { stemId: yearStem, branchId: yearBranch },
    month: { stemId: expectedMonthStemId(yearStem, monthBranch), branchId: monthBranch },
    day: { stemId: dayStem, branchId: dayBranch },
    hour: { stemId: expectedHourStemId(dayStem, hourBranch), branchId: hourBranch },
  };
}

const EXAMPLE_PILLARS = Object.freeze({
  year: Object.freeze({ stemId: 'geng', branchId: 'chen' }),
  month: Object.freeze({ stemId: 'gui', branchId: 'wei' }),
  day: Object.freeze({ stemId: 'wu', branchId: 'yin' }),
  hour: Object.freeze({ stemId: 'geng', branchId: 'shen' }),
});

test('Zi-Mao reciprocal punishment retains all eight directed edges for two occurrences of each', () => {
  const set = deriveCandidates(pillarsForBranches(['zi', 'mao', 'zi', 'mao']));
  const rows = set.candidates.filter(row => row.candidateType === 'branch_directional_punishment_candidate');
  assert.equal(rows.length, 8);
  const edges = new Set(rows.map(row => row.occurrenceRefs.join('->')));
  assert.equal(edges.size, 8);
  for (const row of rows) {
    assert.equal(row.directionality, 'directed');
    assert.ok(edges.has([...row.occurrenceRefs].reverse().join('->')));
    assert.equal(row.effectEligible, false);
  }
  // Independent directed oracle: a five-bit presence mask cannot detect a
  // missing reciprocal edge. Check every ordered symbol pair at fixed slots.
  const directedPairs = ['yin:si', 'si:shen', 'shen:yin', 'chou:xu', 'xu:wei', 'wei:chou', 'zi:mao', 'mao:zi'];
  for (const left of BRANCH_ORDER) for (const right of BRANCH_ORDER) {
    const actual = deriveCandidates(pillarsForBranches([left, right, 'chen', 'xu'])).candidates
      .filter(c => c.candidateType === 'branch_directional_punishment_candidate'
        && c.occurrenceRefs.includes('pillar.year.branch') && c.occurrenceRefs.includes('pillar.month.branch'))
      .map(c => c.occurrenceRefs.join('->')).sort();
    const expected = [];
    if (directedPairs.includes(`${left}:${right}`)) expected.push('pillar.year.branch->pillar.month.branch');
    if (directedPairs.includes(`${right}:${left}`)) expected.push('pillar.month.branch->pillar.year.branch');
    assert.deepEqual(actual, expected.sort(), `${left}:${right}`);
  }
});

test('profile-scoped candidates separate Wu-Gui, clash and punishment levels', () => {
  const set = deriveCandidates(EXAMPLE_PILLARS);
  assert.equal(set.version, 'bazi.profile_scoped_structural_candidate_set.v2');
  assert.equal(set.policy.canonicalFactEligible, false);
  assert.ok(set.candidates.every((row) => row.effectEligible === false));
  assert.ok(set.candidates.every((row) => row.activationStatus === 'not_evaluated'));

  const combination = set.candidates.find((row) => row.candidateType === 'stem_five_combination_candidate');
  assert.deepEqual(combination.occurrenceRefs, [
    'pillar.day.visible_stem', 'pillar.month.visible_stem',
  ]);
  assert.equal(combination.traditionalCorrespondenceElementId, 'fire');
  assert.equal(combination.transformationStatus, 'not_evaluated');

  const clash = set.candidates.find((row) => row.candidateType === 'branch_six_clash_candidate');
  const pairPunishment = set.candidates.find((row) => row.candidateType === 'branch_directional_punishment_candidate');
  const groupPunishment = set.candidates.find((row) => row.candidateType === 'partial_three_member_punishment_membership');
  assert.deepEqual(clash.occurrenceRefs, ['pillar.day.branch', 'pillar.hour.branch']);
  assert.equal(clash.directionality, 'undirected');
  assert.equal(pairPunishment.directionality, 'directed');
  assert.deepEqual(pairPunishment.orderedRoleBindings, [
    { role: 'source', occurrenceRef: 'pillar.hour.branch' },
    { role: 'target', occurrenceRef: 'pillar.day.branch' },
  ]);
  assert.equal(groupPunishment.completeness, 'partial_membership_only');
  assert.equal(groupPunishment.candidateType, 'partial_three_member_punishment_membership');
  assert.deepEqual(groupPunishment.missingMemberRequirements, [{
    requiredSymbol: 'si', requiredRole: 'member_1', multiplicity: 1,
    relationRuleId: 'bazi.relation_rule.punishment_group.punishment_yin_si_shen.v1',
  }]);
});

test('partial group membership expands every present occurrence binding', () => {
  const set = deriveCandidates(pillarsForBranches(['yin', 'yin', 'shen', 'wu']));
  const partial = set.candidates.filter((row) => (
    row.relationRuleId === 'bazi.relation_rule.punishment_group.punishment_yin_si_shen.v1'
  ));
  assert.equal(partial.length, 2);
  assert.equal(new Set(partial.map((row) => row.contentHash)).size, 2);
  assert.ok(partial.every((row) => row.occurrenceRefs.length === 2));
  assert.ok(partial.every((row) => row.missingMemberRequirements[0].requiredSymbol === 'si'));
});

test('complete groups retain every occurrence binding outside the canonical fact graph', () => {
  const set = deriveCandidates(HYPEREDGE_PILLARS);
  const complete = set.candidates.filter((row) => row.relationRuleId.includes('three_harmony'));
  assert.equal(complete.length, 2);
  assert.ok(complete.every((row) => row.completeness === 'complete'));
  assert.notDeepEqual(complete[0].occurrenceRefs, complete[1].occurrenceRefs);
});

test('candidate derivation keeps the strict pillar boundary', () => {
  assert.throws(() => deriveCandidates(null), /pillars must be an object/);
  assert.throws(() => assertProfileScopedStructuralCandidateSet({}), /factory-produced/);
  assert.equal(assertSelfPunishmentCandidatePolicy({
    scope: { selfPunishment: {
      allowSelfLoop: false,
      minimumDistinctOccurrences: 2,
      enumeration: 'all_distinct_occurrence_pairs',
    } },
  }), true);
  assert.throws(() => assertSelfPunishmentCandidatePolicy({}), /self-punishment cardinality/);
});

test('candidate assembly rejects unsupported rules, missing occurrence facts and profile drift', () => {
  const artifact = compileOne({
    version: 'bazi.chart_snapshot.v2',
    snapshotId: 'snapshot:candidate-assembly-guards',
    subjectRef: 'subject:candidate-assembly-guards',
    validTimeRef: 'time:candidate-assembly-guards',
    traditionalSexClass: 'unknown',
    pillars: EXAMPLE_PILLARS,
    provenanceRef: 'test:candidate-assembly-guards',
  });
  const selected = resolveSelectedRelationProfile(RELEASE_CONTEXT, ACTIVE_PROFILE_ID);
  assert.equal(
    assertProfileScopedStructuralCandidateSet(artifact.profileScopedStructuralCandidateSet),
    artifact.profileScopedStructuralCandidateSet,
  );
  const assemble = (relationMaterials, factGraph = artifact.canonicalFactGraph) => (
    buildProfileScopedStructuralCandidateSet({
      relationMaterials,
      selectedRelationProfile: selected,
      factGraph,
      releaseContext: RELEASE_CONTEXT,
    })
  );
  const drift = structuredClone(artifact.relationMaterials);
  drift.profileId = 'profile:drift';
  assert.throws(() => assemble(drift), /one admitted selected RelationProfile/);

  const unsupported = structuredClone(artifact.relationMaterials);
  const relationPair = unsupported.pairs.branches.find((pair) => pair.relationIds.length > 0);
  relationPair.relationIds = ['unsupported_relation'];
  assert.throws(() => assemble(unsupported), /unsupported branch relation candidate/);

  const graphWithoutOccurrences = structuredClone(artifact.canonicalFactGraph);
  graphWithoutOccurrences.facts = graphWithoutOccurrences.facts.filter(
    (fact) => fact.factType !== 'stem_occurrence' && fact.factType !== 'branch_occurrence',
  );
  assert.throws(
    () => assemble(artifact.relationMaterials, graphWithoutOccurrences),
    /not a visible OccurrenceFact/,
  );
});

test('branch relation families remain distinct occurrence-bound candidates', () => {
  const cases = [
    [['zi', 'chou', 'chen', 'si'], 'branch_six_harmony_candidate'],
    [['zi', 'wu', 'chen', 'si'], 'branch_six_clash_candidate'],
    [['zi', 'wei', 'chen', 'si'], 'branch_six_harm_candidate'],
    [['zi', 'you', 'chen', 'si'], 'branch_six_break_candidate'],
    [['yin', 'si', 'chen', 'wu'], 'branch_directional_punishment_candidate'],
    [['chen', 'chen', 'yin', 'wu'], 'branch_self_punishment_candidate'],
    [['yin', 'si', 'shen', 'wu'], 'three_member_punishment_hyperedge_candidate'],
  ];
  for (const [branches, expectedType] of cases) {
    const set = deriveCandidates(pillarsForBranches(branches));
    const candidate = set.candidates.find((row) => row.candidateType === expectedType);
    assert.ok(candidate, `missing ${expectedType}`);
    assert.equal(candidate.supportingFactRefs.length, candidate.occurrenceRefs.length);
    assert.ok(candidate.supportingFactRefs.every((ref) => ref.startsWith('fact:')));
    assert.equal(candidate.effectEligible, false);
    assert.equal(candidate.activationStatus, 'not_evaluated');
    assert.equal(candidate.transformationStatus, 'not_evaluated');
  }
});
