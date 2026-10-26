import { assertProfileScopedStructuralCandidateSet } from './candidates.mjs';
import { deepFreeze } from '../shared/assert.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';

export const PROFILE_SCOPED_RAW_RELATION_MATCHES_VERSION =
  'bazi.profile_scoped_raw_relation_matches.v1';

export const FIXED_LAYER_FORBIDDEN_FIELDS = Object.freeze([
  'activationStatus', 'transformationStatus', 'effectEligible',
  'favorabilityInferred', 'strengthInferred', 'precedenceInferred',
  'productAuthority', 'active', 'inactive', 'favorable', 'unfavorable',
  'strength', 'intensity', 'effect', 'score', 'judgment', 'claim',
  'event', 'naturalLanguageSummary',
]);

const rawMatchSets = new WeakSet();
const HASH_METADATA = deepFreeze({
  hashProfileId: 'formal.sha256.domain_separated.v1',
  hashScope: 'content_identity',
  hashViewSchemaVersion: 'bazi.raw_relation_match_hash_view.v1',
});

/**
 * @typedef {object} RawRelationMatchV1
 * @property {'bazi.raw_relation_match.v1'} version
 * @property {'complete_membership'|'partial_membership'} membership
 * @property {string[]} occurrenceRefs
 * @property {string[]} supportingFactRefs
 * @property {string} contentHash
 */

/**
 * @typedef {object} ProfileScopedRawRelationMatchesV1
 * @property {'bazi.profile_scoped_raw_relation_matches.v1'} version
 * @property {string} selectedRelationProfileHash
 * @property {RawRelationMatchV1[]} matches
 * @property {string} rawRelationMatchSetHash
 */

export function rawRelationTypeOf(candidateType) {
  const table = {
    stem_five_combination_candidate: 'stem_five_combination',
    branch_six_harmony_candidate: 'branch_six_harmony',
    branch_six_clash_candidate: 'branch_six_clash',
    branch_six_harm_candidate: 'branch_six_harm',
    branch_six_break_candidate: 'branch_six_break',
    branch_directional_punishment_candidate: 'branch_directional_punishment',
    branch_self_punishment_candidate: 'branch_self_punishment',
    complete_group_candidate: 'complete_group_membership',
    three_member_punishment_hyperedge_candidate: 'three_member_punishment_membership',
    partial_group_membership: 'partial_group_membership',
    partial_three_member_punishment_membership: 'partial_three_member_punishment_membership',
  };
  const result = table[candidateType];
  if (!result) throw new TypeError(`unsupported structural candidate projection: ${candidateType}`);
  return result;
}

function projectMatch(candidate, selectedRelationProfileHash) {
  const membership = candidate.completeness === 'complete'
    ? 'complete_membership'
    : 'partial_membership';
  const body = {
    version: 'bazi.raw_relation_match.v1',
    rawRelationType: rawRelationTypeOf(candidate.candidateType),
    relationRuleId: candidate.relationRuleId,
    membership,
    arity: candidate.arity,
    directionality: candidate.directionality,
    roleBindings: candidate.orderedRoleBindings,
    occurrenceRefs: candidate.occurrenceRefs,
    supportingFactRefs: candidate.supportingFactRefs,
    requiredSymbols: candidate.requiredSymbols,
    missingRequirements: candidate.missingMemberRequirements,
    selectedRelationProfileHash,
    ...(candidate.traditionalCorrespondenceElementId == null ? {} : {
      traditionalCorrespondence: {
        elementId: candidate.traditionalCorrespondenceElementId,
        semantics: 'relation_rule_correspondence_only_not_transformation',
      },
    }),
    hashMetadata: HASH_METADATA,
  };
  return deepFreeze({
    ...body,
    contentHash: domainHashV1('bazi.raw_relation_match.v1', body),
  });
}

export function projectProfileScopedRawRelationMatches(candidateSetValue) {
  const candidateSet = assertProfileScopedStructuralCandidateSet(candidateSetValue);
  const matches = deepFreeze(candidateSet.candidates.map((candidate) => projectMatch(
    candidate,
    candidateSet.selectedRelationProfileHash,
  )).sort((left, right) => compareCanonical(left.contentHash, right.contentHash)));
  const body = deepFreeze({
    version: PROFILE_SCOPED_RAW_RELATION_MATCHES_VERSION,
    selectedRelationProfileHash: candidateSet.selectedRelationProfileHash,
    profileId: candidateSet.profileId,
    profileContentHash: candidateSet.profileContentHash,
    canonicalFactGraphHash: candidateSet.canonicalFactGraphHash,
    relationContentHash: candidateSet.relationContentHash,
    structuralCandidateEnumeratorHash: candidateSet.structuralCandidateEnumeratorHash,
    matchCount: matches.length,
    matches,
    hashMetadata: {
      ...HASH_METADATA,
      hashViewSchemaVersion: 'bazi.raw_relation_match_set_hash_view.v1',
    },
  });
  const result = deepFreeze({
    ...body,
    rawRelationMatchSetHash:
      domainHashV1('bazi.profile_scoped_raw_relation_matches.v1', body),
  });
  rawMatchSets.add(result);
  return result;
}

export function assertProfileScopedRawRelationMatches(value, field = 'ProfileScopedRawRelationMatchesV1') {
  if (!value || typeof value !== 'object' || !rawMatchSets.has(value)) {
    throw new TypeError(`${field} must be factory-produced`);
  }
  return value;
}

export function assertNoForbiddenFixedFields(value, field = 'fixed artifact') {
  if (value == null || typeof value !== 'object') return true;
  for (const key of Object.keys(value)) {
    if (FIXED_LAYER_FORBIDDEN_FIELDS.includes(key)) {
      throw new TypeError(`${field} contains forbidden evaluation field: ${key}`);
    }
    assertNoForbiddenFixedFields(value[key], `${field}.${key}`);
  }
  return true;
}
