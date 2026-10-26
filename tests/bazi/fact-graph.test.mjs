import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_TYPES,
  FACT_TYPE_SCHEMAS,
  buildEvaluationContext,
  buildFactView,
  buildOverlayFactGraph,
  deriveCanonicalFactGraph,
  unrankGrammarState19,
} from '../../src/index.mjs';
import { factTypeSchemaOf } from '../../src/bazi/fact-graph.mjs';
import {
  BRANCH_KEY,
  HYPEREDGE_PILLARS,
  RELEASE_CONTEXT,
  SAMPLE_SNAPSHOT,
  branchKey,
} from '../helpers.mjs';
import { compileOne } from '../natal-fixtures.mjs';

const ALLOWED_RELEASES = Object.freeze([RELEASE_CONTEXT.releaseManifestHash]);
const graphOf = (pillars) => deriveCanonicalFactGraph(pillars, RELEASE_CONTEXT);

test('CanonicalFactGraphV4 is a relation-profile-independent TypedFact and Derivation DAG', () => {
  assert.equal(factTypeSchemaOf('root_pillar'), FACT_TYPE_SCHEMAS.root_pillar);
  assert.throws(() => factTypeSchemaOf('unknown'), /unknown CanonicalFactGraph factType/);
  const graph = graphOf(HYPEREDGE_PILLARS);
  assert.equal(graph.version, 'bazi.canonical_fact_graph.v4');
  assert.equal(graph.canonicalScope, 'relation_profile_independent_manifest_scoped_typed_fact_dag');
  assert.equal(graph.factCount, graph.facts.length);
  assert.equal(graph.derivationCount, graph.derivations.length);
  assert.match(graph.coordinateHash, /^sha256:/);
  assert.match(graph.foundationDependencyHash, /^sha256:/);
  assert.match(graph.canonicalFactGraphHash, /^sha256:/);
  assert.deepEqual([...graph.facts].map((fact) => fact.contentHash),
    [...graph.facts].map((fact) => fact.contentHash).sort());
  assert.deepEqual([...graph.derivations].map((row) => row.derivationHash),
    [...graph.derivations].map((row) => row.derivationHash).sort());
  const types = new Set(graph.facts.map((fact) => fact.factType));
  for (const type of FACT_TYPES) assert.ok(types.has(type), `missing ${type}`);
  const ids = new Set(graph.facts.map((fact) => fact.factId));
  for (const fact of graph.facts) {
    assert.equal(fact.predicate, FACT_TYPE_SCHEMAS[fact.factType].predicate);
    assert.equal(fact.stratum, FACT_TYPE_SCHEMAS[fact.factType].stratum);
    assert.equal(fact.derivationRefs.length, 1);
    assert.equal(fact.derivationRefs[0], fact.derivationHash);
    assert.equal(Object.isFrozen(fact.identityProvenanceRefs), true);
    for (const ref of fact.inputFactRefs) assert.ok(ids.has(ref), `dangling ${ref}`);
  }
});

test('P1 occurrence scope, quantities and role bindings are frozen', () => {
  const graph = graphOf(HYPEREDGE_PILLARS);
  const ofType = (type) => graph.facts.filter((fact) => fact.factType === type);
  assert.equal(ofType('root_pillar').length, 4);
  assert.equal(ofType('stem_occurrence').length, 4);
  assert.equal(ofType('branch_occurrence').length, 4);
  assert.equal(ofType('day_master').length, 1);
  assert.equal(ofType('element_polarity_assignment').length, 8);
  assert.equal(ofType('growth_stage').length, 4);
  assert.equal(ofType('directed_element_relation').length, 12);
  assert.equal(ofType('day_master')[0].value.dayMasterOccurrenceRef, 'pillar.day.visible_stem');
  const branchFactIds = new Set(ofType('branch_occurrence').map((fact) => fact.factId));
  const stemTargetFactIds = new Set([
    ...ofType('stem_occurrence'), ...ofType('hidden_stem_occurrence'),
  ].map((fact) => fact.factId));
  for (const fact of ofType('hidden_stem_occurrence')) {
    assert.ok(branchFactIds.has(fact.inputFactRefs[0]));
    assert.equal(fact.value.role, 'profile_order_only_no_weight');
  }
  for (const fact of ofType('ten_god_relation')) assert.ok(stemTargetFactIds.has(fact.inputFactRefs[1]));
  for (const fact of ofType('growth_stage')) {
    assert.equal(fact.value.calculationScope, 'day_master_to_four_natal_branches');
    assert.match(fact.value.targetBranchOccurrenceRef, /\.branch$/);
  }
  for (const fact of ofType('directed_element_relation')) {
    assert.equal(fact.value.scope, 'six_fixed_visible_pillar_pairs_stems_and_branches_no_hidden_no_self');
  }
  assert.equal(JSON.stringify(graph).includes('combinationCandidate'), false);
});

test('fact graph identity is insertion-independent and carries no school branch', () => {
  const graph = graphOf(SAMPLE_SNAPSHOT.pillars);
  assert.equal(graphOf(SAMPLE_SNAPSHOT.pillars).canonicalFactGraphHash, graph.canonicalFactGraphHash);
  assert.notEqual(graphOf(unrankGrammarState19(9_999)).canonicalFactGraphHash, graph.canonicalFactGraphHash);
  for (const forbidden of ['branchKey', 'branchHash', 'ruleProfileId', 'activeProfileId']) {
    assert.equal(JSON.stringify(graph).includes(forbidden), false);
  }
});

test('FactView reads by id, semantic identity, predicate, stratum and subject', () => {
  const graph = graphOf(SAMPLE_SNAPSHOT.pillars);
  const view = buildFactView(graph);
  const day = view.factById('fact:root_pillar:day');
  assert.equal(view.canonicalFactGraphHash, graph.canonicalFactGraphHash);
  assert.equal(view.factBySemanticHash(day.semanticHash), day);
  assert.equal(view.factsOfType('root_pillar').length, 4);
  assert.equal(view.factsForPredicate('bazi.pillar.root').length, 4);
  assert.equal(view.factsAtStratum(0).length, 4);
  assert.ok(view.factsAbout('pillar.day.visible_stem').length > 0);
  assert.equal(view.factById('missing'), null);
  assert.equal(view.factBySemanticHash('missing'), null);
  assert.deepEqual(view.factsOfType('missing'), []);
  assert.deepEqual(view.factsForPredicate('missing'), []);
  assert.deepEqual(view.factsAtStratum(999), []);
  assert.deepEqual(view.factsAbout('missing'), []);
  assert.throws(() => buildFactView({ ...graph }), /factory-produced CanonicalFactGraph/);
});

test('yin day master takes the reverse growth-stage branch without changing P1 scope', () => {
  const graph = graphOf({
    year: { stemId: 'yi', branchId: 'chou' },
    month: { stemId: 'ji', branchId: 'mao' },
    day: { stemId: 'yi', branchId: 'chou' },
    hour: { stemId: 'ding', branchId: 'chou' },
  });
  const stages = graph.facts.filter((fact) => fact.factType === 'growth_stage');
  assert.equal(stages.length, 4);
  assert.ok(stages.every((fact) => fact.value.directionRule === 'reverse'));
});

test('evaluation context binds one artifact and optional foundation-bound overlay', () => {
  const artifact = compileOne(SAMPLE_SNAPSHOT);
  const overlayGraph = graphOf(unrankGrammarState19(9_999));
  const overlay = buildOverlayFactGraph({
    factGraph: overlayGraph,
    natalFoundationDependencyHash: artifact.foundationDependencyHash,
  });
  const context = buildEvaluationContext({
    selectedArtifact: artifact,
    overlayFactGraph: overlay,
    branchKey: BRANCH_KEY,
    allowedReleaseManifestHashes: ALLOWED_RELEASES,
    engineVersion: 'engine:test:1',
  });
  assert.deepEqual(context.scopes, ['natal', 'temporal']);
  assert.deepEqual(context.describeCacheKey(), {
    natalHash: context.natalHash,
    candidateSetHash: context.candidateSetHash,
    overlayHash: context.overlayHash,
    branchHash: context.branchKey.branchHash,
    selectedCompiledArtifactRef: context.selectedCompiledArtifactRef,
    allowedReleaseManifestHashes: context.allowedReleaseManifestHashes,
    engineVersion: context.engineVersion,
    contextHash: context.contextHash,
    analysisContextHash: context.analysisContextHash,
  });
  assert.equal(context.natalHash, artifact.canonicalFactGraphHash);
  assert.equal(context.viewOf('temporal').canonicalFactGraphHash, overlayGraph.canonicalFactGraphHash);
  assert.throws(() => context.viewOf('destiny'), /unknown evaluation scope/);
  const otherBranch = buildEvaluationContext({
    selectedArtifact: artifact,
    overlayFactGraph: overlay,
    branchKey: branchKey({ ruleProfileId: 'bazi.school.other.v1' }),
    allowedReleaseManifestHashes: ALLOWED_RELEASES,
    engineVersion: 'engine:test:1',
  });
  assert.notEqual(otherBranch.contextHash, context.contextHash);
});

test('evaluation context rejects forged artifacts, overlays and release scope', () => {
  const artifact = compileOne(SAMPLE_SNAPSHOT);
  const valid = {
    selectedArtifact: artifact,
    branchKey: BRANCH_KEY,
    allowedReleaseManifestHashes: ALLOWED_RELEASES,
    engineVersion: 'engine:test:1',
  };
  assert.throws(() => buildEvaluationContext({ ...valid, selectedArtifact: {} }), /factory-produced/);
  assert.throws(() => buildEvaluationContext(), /factory-produced|must be an object/);
  assert.throws(() => buildOverlayFactGraph(), /factory-produced|must be an object/);
  assert.throws(() => buildEvaluationContext({ ...valid, overlayFactGraph: {} }), /factory-produced/);
  assert.throws(() => buildEvaluationContext({ ...valid, allowedReleaseManifestHashes: [] }), /not allowed/);
  const mismatch = buildOverlayFactGraph({
    factGraph: graphOf(unrankGrammarState19(9_999)),
    natalFoundationDependencyHash: `sha256:${'0'.repeat(64)}`,
  });
  assert.throws(
    () => buildEvaluationContext({ ...valid, overlayFactGraph: mismatch }),
    /natalFoundationDependencyHash/,
  );
  const natalOnly = buildEvaluationContext(valid);
  assert.deepEqual(natalOnly.scopes, ['natal']);
  assert.equal(natalOnly.viewOf('natal').canonicalFactGraphHash, artifact.canonicalFactGraphHash);
  assert.equal(natalOnly.viewOf('temporal'), null);
});
