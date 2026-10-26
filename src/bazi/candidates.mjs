import { buildValidatedPillarCoordinate, captureValidatedPillars } from './encoding.mjs';
import { compileRelationMaterials, compileStructuralMaterials } from './materials.mjs';
import { buildCanonicalFactGraphFromMaterials } from './fact-graph.mjs';
import {
  assertResolvedReleaseContext,
  assertSelectedRelationProfile,
  resolveSelectedRelationProfile,
} from '../release/manifest.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';
import { deepFreeze } from '../shared/assert.mjs';

export const PROFILE_SCOPED_CANDIDATE_SET_VERSION = 'bazi.profile_scoped_structural_candidate_set.v2';
const candidateSetInstances = new WeakSet();

export function assertSelfPunishmentCandidatePolicy(profile) {
  const policy = profile?.scope?.selfPunishment;
  if (policy?.allowSelfLoop !== false
    || policy.minimumDistinctOccurrences !== 2
    || policy.enumeration !== 'all_distinct_occurrence_pairs') {
    throw new TypeError('selected RelationProfile must declare distinct-occurrence self-punishment cardinality');
  }
  return true;
}

function occurrenceFactMap(factGraph) {
  return new Map(factGraph.facts
    .filter((fact) => fact.factType === 'stem_occurrence' || fact.factType === 'branch_occurrence')
    .map((fact) => [fact.value.occurrenceId, fact.factId]));
}

function factRefs(occurrenceRefs, factsByOccurrence) {
  return occurrenceRefs.map((occurrenceRef) => {
    const factRef = factsByOccurrence.get(occurrenceRef);
    if (!factRef) throw new TypeError(`candidate participant is not a visible OccurrenceFact: ${occurrenceRef}`);
    return factRef;
  });
}

function cartesian(options, prefix = [], output = []) {
  if (options.length === 0) {
    output.push(prefix);
    return output;
  }
  for (const item of options[0]) cartesian(options.slice(1), [...prefix, item], output);
  return output;
}

function makeCandidate(body, selectedProfile) {
  const semanticBody = {
    candidateType: body.candidateType,
    relationRuleId: body.relationRuleId,
    arity: body.arity,
    directionality: body.directionality,
    orderedRoleBindings: body.orderedRoleBindings,
    occurrenceRefs: body.occurrenceRefs,
    completeness: body.completeness,
    missingMemberRequirements: body.missingMemberRequirements,
  };
  const semanticHash = domainHashV1('bazi.structural_candidate.semantic.v1', semanticBody);
  const contentBody = {
    ...body,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    semanticHash,
  };
  const contentHash = domainHashV1('bazi.structural_candidate.content.v1', contentBody);
  return deepFreeze({
    candidateId: `structural-candidate:${contentHash}`,
    ...contentBody,
    contentHash,
  });
}

function pairCandidateBody({ candidateType, relationRuleId, occurrenceRefs, symbols, directionality,
  sourceOccurrenceRef = null, targetOccurrenceRef = null, supportingFactRefs,
  traditionalCorrespondenceElementId = null }) {
  const orderedOccurrences = directionality === 'directed'
    ? [sourceOccurrenceRef, targetOccurrenceRef]
    : [...occurrenceRefs].sort(compareCanonical);
  return {
    candidateType,
    relationRuleId,
    arity: 2,
    directionality,
    orderedRoleBindings: directionality === 'directed'
      ? [
        { role: 'source', occurrenceRef: sourceOccurrenceRef },
        { role: 'target', occurrenceRef: targetOccurrenceRef },
      ]
      : orderedOccurrences.map((occurrenceRef, index) => ({ role: `member_${index}`, occurrenceRef })),
    occurrenceRefs: orderedOccurrences,
    supportingFactRefs: [...supportingFactRefs].sort(compareCanonical),
    completeness: 'complete',
    requiredSymbols: [...symbols].sort(compareCanonical),
    missingMemberRequirements: [],
    traditionalCorrespondenceElementId,
    activationStatus: 'not_evaluated',
    transformationStatus: 'not_evaluated',
    effectEligible: false,
  };
}

function branchType(relationType, punishmentKind) {
  if (relationType === 'six_harmony') return 'branch_six_harmony_candidate';
  if (relationType === 'clash') return 'branch_six_clash_candidate';
  if (relationType === 'harm') return 'branch_six_harm_candidate';
  if (relationType === 'break') return 'branch_six_break_candidate';
  if (relationType === 'punishment') return punishmentKind === 'self_punishment_between_distinct_occurrences'
    ? 'branch_self_punishment_candidate'
    : 'branch_directional_punishment_candidate';
  throw new TypeError(`unsupported branch relation candidate: ${relationType}`);
}

function pairCandidates(relationMaterials, selectedProfile, factsByOccurrence) {
  const result = [];
  for (const pair of relationMaterials.pairs.stems) {
    if (!pair.combinationCandidate) continue;
    result.push(makeCandidate(pairCandidateBody({
      candidateType: 'stem_five_combination_candidate',
      relationRuleId: 'bazi.relation_rule.stem_five_combination.v1',
      occurrenceRefs: pair.participantRefs,
      symbols: [pair.leftStemId, pair.rightStemId],
      directionality: 'undirected',
      supportingFactRefs: factRefs(pair.participantRefs, factsByOccurrence),
      traditionalCorrespondenceElementId: pair.traditionalCorrespondenceElementId,
    }), selectedProfile));
  }
  for (const pair of relationMaterials.pairs.branches) {
    for (const relationType of pair.relationIds) {
      const declared = relationType === 'punishment' ? pair.punishmentDirection : null;
      const directions = declared?.kind === 'bidirectional'
        ? [
          { kind: 'directed', sourceOccurrenceRef: declared.sourceOccurrenceRef, targetOccurrenceRef: declared.targetOccurrenceRef },
          { kind: 'directed', sourceOccurrenceRef: declared.targetOccurrenceRef, targetOccurrenceRef: declared.sourceOccurrenceRef },
        ]
        : [declared];
      for (const punishment of directions) {
      const isDirected = punishment?.kind === 'directed';
      result.push(makeCandidate(pairCandidateBody({
        candidateType: branchType(relationType, punishment?.kind),
        relationRuleId: `bazi.relation_rule.branch_${relationType}.v1`,
        occurrenceRefs: pair.participantRefs,
        symbols: [pair.leftBranchId, pair.rightBranchId],
        directionality: isDirected ? 'directed' : 'undirected',
        sourceOccurrenceRef: isDirected ? punishment.sourceOccurrenceRef : null,
        targetOccurrenceRef: isDirected ? punishment.targetOccurrenceRef : null,
        supportingFactRefs: factRefs(pair.participantRefs, factsByOccurrence),
      }), selectedProfile));
      }
    }
  }
  return result;
}

function groupCandidates(relationMaterials, selectedProfile, factsByOccurrence) {
  const result = [];
  const occurrencesByBranch = new Map();
  for (const occurrence of relationMaterials.occurrences.branches) {
    if (!occurrencesByBranch.has(occurrence.branchId)) occurrencesByBranch.set(occurrence.branchId, []);
    occurrencesByBranch.get(occurrence.branchId).push(occurrence.occurrenceRef);
  }
  for (const occurrences of occurrencesByBranch.values()) occurrences.sort(compareCanonical);
  for (const group of selectedProfile.profile.completeHyperedgeGroups) {
    const presentSymbols = group.memberBranchIds.filter((id) => occurrencesByBranch.has(id));
    if (presentSymbols.length < 2) continue;
    const missingSymbols = group.memberBranchIds.filter((id) => !occurrencesByBranch.has(id));
    for (const occurrenceRefs of cartesian(presentSymbols.map((id) => occurrencesByBranch.get(id)))) {
      const complete = missingSymbols.length === 0;
      const directionality = group.relationId === 'punishment_group'
        ? 'ordered_by_profile_roles'
        : 'undirected_hyperedge';
      const orderedRoleBindings = occurrenceRefs.map((occurrenceRef, index) => ({
        role: `member_${group.memberBranchIds.indexOf(presentSymbols[index])}`,
        occurrenceRef,
      }));
      const missingMemberRequirements = missingSymbols.map((requiredSymbol) => ({
        requiredSymbol,
        requiredRole: `member_${group.memberBranchIds.indexOf(requiredSymbol)}`,
        multiplicity: 1,
        relationRuleId: `bazi.relation_rule.${group.relationId}.${group.id}.v1`,
      }));
      result.push(makeCandidate({
        candidateType: complete
          ? (group.relationId === 'punishment_group'
            ? 'three_member_punishment_hyperedge_candidate'
            : 'complete_group_candidate')
          : (group.relationId === 'punishment_group'
            ? 'partial_three_member_punishment_membership'
            : 'partial_group_membership'),
        relationRuleId: `bazi.relation_rule.${group.relationId}.${group.id}.v1`,
        arity: 3,
        directionality,
        orderedRoleBindings,
        occurrenceRefs: directionality === 'undirected_hyperedge'
          ? [...occurrenceRefs].sort(compareCanonical)
          : occurrenceRefs,
        supportingFactRefs: factRefs(occurrenceRefs, factsByOccurrence).sort(compareCanonical),
        completeness: complete ? 'complete' : 'partial_membership_only',
        requiredSymbols: group.memberBranchIds,
        missingMemberRequirements,
        traditionalCorrespondenceElementId: null,
        activationStatus: 'not_evaluated',
        transformationStatus: 'not_evaluated',
        effectEligible: false,
      }, selectedProfile));
    }
  }
  return result;
}

export function buildProfileScopedStructuralCandidateSet({
  relationMaterials,
  selectedRelationProfile,
  factGraph,
  releaseContext,
}) {
  const context = assertResolvedReleaseContext(releaseContext);
  const selected = assertSelectedRelationProfile(selectedRelationProfile);
  assertSelfPunishmentCandidatePolicy(selected.profile);
  if (selected.profileId !== relationMaterials.profileId
    || selected.selectedRelationProfileHash !== relationMaterials.selectedRelationProfileHash
    || selected.releaseManifestHash !== context.releaseManifestHash) {
    throw new TypeError('candidate compilation requires one admitted selected RelationProfile');
  }
  const factsByOccurrence = occurrenceFactMap(factGraph);
  const candidates = deepFreeze([
    ...pairCandidates(relationMaterials, selected, factsByOccurrence),
    ...groupCandidates(relationMaterials, selected, factsByOccurrence),
  ].sort((left, right) => compareCanonical(left.contentHash, right.contentHash)));
  const body = deepFreeze({
    version: PROFILE_SCOPED_CANDIDATE_SET_VERSION,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    profileId: selected.profileId,
    profileContentHash: selected.profileContentHash,
    canonicalFactGraphHash: factGraph.canonicalFactGraphHash,
    relationContentHash: relationMaterials.contentHash,
    structuralCandidateEnumeratorHash:
      context.componentHashes.structuralCandidateEnumeratorHash,
    policy: {
      canonicalFactEligible: false,
      ruleEvaluationRequired: true,
      activationInferred: false,
      transformationInferred: false,
      favorabilityInferred: false,
      effectEligible: false,
    },
    candidateCount: candidates.length,
    candidates,
  });
  const result = deepFreeze({
    ...body,
    structuralCandidateSetHash:
      domainHashV1('bazi.profile_scoped_structural_candidate_set.v2', body),
  });
  candidateSetInstances.add(result);
  return result;
}

export function assertProfileScopedStructuralCandidateSet(value, field = 'ProfileScopedStructuralCandidateSetV2') {
  if (!value || typeof value !== 'object' || !candidateSetInstances.has(value)) {
    throw new TypeError(`${field} must be a factory-produced ProfileScopedStructuralCandidateSetV2`);
  }
  return value;
}

export function deriveProfileScopedStructuralCandidateSet(pillars, releaseContextValue, activeProfileId) {
  const releaseContext = assertResolvedReleaseContext(releaseContextValue);
  const selected = resolveSelectedRelationProfile(releaseContext, activeProfileId);
  const coordinate = buildValidatedPillarCoordinate(captureValidatedPillars(pillars));
  const structuralMaterials = compileStructuralMaterials(coordinate, releaseContext);
  const relationMaterials = compileRelationMaterials(coordinate, selected);
  const factGraph = buildCanonicalFactGraphFromMaterials({ coordinate, structuralMaterials });
  return buildProfileScopedStructuralCandidateSet({
    relationMaterials,
    selectedRelationProfile: selected,
    factGraph,
    releaseContext,
  });
}
