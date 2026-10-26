import { BRANCH_IDS, SEXAGENARY_PILLARS, STEM_IDS } from './constants.mjs';
import { BAZI_STRUCTURAL_CODEBOOK, GROWTH_STAGE_PROFILE_ID, HIDDEN_STEM_PROFILE_ID } from './foundation-profile.mjs';
import { assertCanonicalFactGraph } from './fact-graph.mjs';
import { assertProfileScopedRawRelationMatches, assertNoForbiddenFixedFields } from './raw-relation-matches.mjs';
import { assertSelectedRelationProfile } from '../release/manifest.mjs';
import { branchElementCodeOf, elementRelationCodeOf, growthStageCodeOf, hiddenStemCodesOf, tenGodCodeOf } from './structure.mjs';
import { captureExactDataRecord, captureJsonData, deepFreeze, requiredString } from '../shared/assert.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';

export const TEMPORAL_MATCH_INDEX_VERSION = 'bazi.temporal_match_index.v1';
export const RAW_STRUCTURAL_MATCH_SET_VERSION = 'bazi.raw_structural_match_set.v1';

const temporalIndexes = new WeakSet();
const HASH_PROFILE_ID = 'formal.sha256.domain_separated.v1';

/**
 * @typedef {object} TemporalOccurrenceV1
 * @property {string} occurrenceId
 * @property {string} layer
 * @property {string} slot
 * @property {string} [stemId]
 * @property {string} [branchId]
 * @property {string} sourceTimeRef
 */

/**
 * @typedef {object} TemporalMatchIndexV1
 * @property {'bazi.temporal_match_index.v1'} version
 * @property {Record<string, object>} byStem
 * @property {Record<string, object>} byBranch
 * @property {object[]} byPillar60
 * @property {string} temporalMatchIndexHash
 */

/**
 * @typedef {object} RawStructuralMatchSetV1
 * @property {'bazi.raw_structural_match_set.v1'} version
 * @property {TemporalOccurrenceV1[]} temporalOccurrences
 * @property {object[]} matches
 * @property {string} rawStructuralMatchSetHash
 */
const domains = BAZI_STRUCTURAL_CODEBOOK.domains;
const domainRows = Object.fromEntries(Object.entries(domains).map(([key, domain]) => [
  key,
  { byId: new Map(domain.values.map((row) => [row.id, row])), byCode: domain.values },
]));

function hashMetadata(hashScope, hashViewSchemaVersion) {
  return deepFreeze({ hashProfileId: HASH_PROFILE_ID, hashScope, hashViewSchemaVersion });
}

function hashed(domain, body) {
  return deepFreeze({ ...body, contentHash: domainHashV1(domain, body) });
}

export function temporalFactMaps(graph) {
  const byOccurrence = new Map();
  let dayMaster = null;
  for (const fact of graph.facts) {
    const occurrenceId = fact.value?.occurrenceId ?? fact.value?.hiddenStemOccurrenceId;
    if (occurrenceId) byOccurrence.set(occurrenceId, fact.factId);
    if (fact.factType === 'day_master') dayMaster = fact;
  }
  if (!dayMaster) throw new TypeError('CanonicalFactGraph lacks DayMasterFact');
  return { byOccurrence, dayMaster };
}

function relationId(fromElementId, toElementId) {
  return domainRows.elementRelations.byCode[elementRelationCodeOf(fromElementId, toElementId)].id;
}

function tenGodId(dayStemId, targetStemId) {
  return domainRows.tenGods.byCode[tenGodCodeOf(dayStemId, targetStemId)].id;
}

function growthStageId(dayStemId, branchId) {
  return domainRows.growthStages.byCode[growthStageCodeOf(dayStemId, branchId)].id;
}

function cartesian(options, prefix = [], output = []) {
  if (options.length === 0) {
    output.push(prefix);
    return output;
  }
  for (const item of options[0]) cartesian(options.slice(1), [...prefix, item], output);
  return output;
}

function pairRuleRows(profile, temporalBranchId, natalBranchId) {
  const matches = [];
  for (const [relationIdValue, pairs] of Object.entries(profile.branchPairCandidates)) {
    for (const [sourceSymbol, targetSymbol] of pairs) {
      if (relationIdValue === 'punishment') {
        if (sourceSymbol === targetSymbol
          && sourceSymbol === temporalBranchId && targetSymbol === natalBranchId) {
          matches.push({
            relationId: relationIdValue,
            directionality: 'undirected_distinct_occurrences',
            temporalRole: 'member_0',
            natalRole: 'member_1',
          });
        } else if (sourceSymbol === temporalBranchId && targetSymbol === natalBranchId) {
          matches.push({
            relationId: relationIdValue,
            directionality: 'directed',
            temporalRole: 'source',
            natalRole: 'target',
          });
        } else if (sourceSymbol === natalBranchId && targetSymbol === temporalBranchId) {
          matches.push({
            relationId: relationIdValue,
            directionality: 'directed',
            temporalRole: 'target',
            natalRole: 'source',
          });
        }
      } else if ((sourceSymbol === temporalBranchId && targetSymbol === natalBranchId)
        || (sourceSymbol === natalBranchId && targetSymbol === temporalBranchId)) {
        matches.push({
          relationId: relationIdValue,
          directionality: 'undirected',
          temporalRole: 'member_temporal',
          natalRole: 'member_natal',
        });
      }
    }
  }
  return matches;
}

function buildStemEntry(stemId, structuralMaterials, selected, maps) {
  const stem = domainRows.stems.byId.get(stemId);
  const dayStemId = structuralMaterials.dayMaster.stemId;
  const symbolicTemporalRef = `temporal.stem.${stemId}`;
  const elementRelations = [];
  const ruleMatches = [];
  for (const pillar of Object.values(structuralMaterials.pillars)) {
    const occurrenceRef = `pillar.${pillar.slot}.visible_stem`;
    const natalFactRef = maps.byOccurrence.get(occurrenceRef);
    const relationBody = {
      version: 'bazi.temporal_stem_element_index_record.v1',
      temporalStemId: stemId,
      natalOccurrenceRef: occurrenceRef,
      natalStemId: pillar.stem.stemId,
      temporalToNatalElementRelationId: relationId(stem.elementId, pillar.stem.elementId),
      natalToTemporalElementRelationId: relationId(pillar.stem.elementId, stem.elementId),
      relationRuleId: 'bazi.fixed_rule.directed_element_relation.v1',
      directionality: 'explicit_both_directions',
      roleBindings: [
        { role: 'temporal', occurrenceRef: symbolicTemporalRef },
        { role: 'natal', occurrenceRef },
      ],
      sourceFactRefs: [natalFactRef],
      selectedRelationProfileHash: selected.selectedRelationProfileHash,
    };
    elementRelations.push(hashed('bazi.temporal_stem_element_index_record.v1', relationBody));
    for (const rule of selected.profile.stemCombinationPairs) {
      if (!rule.memberStemIds.includes(stemId) || !rule.memberStemIds.includes(pillar.stem.stemId)) continue;
      const ruleBody = {
        version: 'bazi.temporal_stem_rule_index_record.v1',
        temporalStemId: stemId,
        natalOccurrenceRef: occurrenceRef,
        natalStemId: pillar.stem.stemId,
        relationRuleId: 'bazi.relation_rule.stem_five_combination.v1',
        membership: 'complete_membership',
        directionality: 'undirected',
        roleBindings: [
          { role: 'member_temporal', occurrenceRef: symbolicTemporalRef },
          { role: 'member_natal', occurrenceRef },
        ],
        requiredSymbols: rule.memberStemIds,
        missingRequirements: [],
        traditionalCorrespondence: {
          elementId: rule.traditionalCorrespondenceElementId,
          semantics: 'relation_rule_correspondence_only_not_transformation',
        },
        sourceFactRefs: [natalFactRef],
        selectedRelationProfileHash: selected.selectedRelationProfileHash,
      };
      ruleMatches.push(hashed('bazi.temporal_stem_rule_index_record.v1', ruleBody));
    }
  }
  elementRelations.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  ruleMatches.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  const body = {
    version: 'bazi.temporal_stem_index_entry.v1',
    stemId,
    stemCode: stem.code,
    elementId: stem.elementId,
    polarityId: stem.polarityId,
    relativeToDayMaster: {
      dayMasterFactRef: maps.dayMaster.factId,
      tenGodId: tenGodId(dayStemId, stemId),
      dayMasterToTemporalElementRelationId: relationId(
        structuralMaterials.dayMaster.elementId,
        stem.elementId,
      ),
    },
    elementRelations,
    ruleMatches,
    sourceFactRefs: [maps.dayMaster.factId, ...elementRelations.map((row) => row.sourceFactRefs[0])]
      .filter((value, index, list) => list.indexOf(value) === index).sort(compareCanonical),
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    hashMetadata: hashMetadata('content_identity', 'bazi.temporal_stem_index_hash_view.v1'),
  };
  return hashed('bazi.temporal_stem_index_entry.v1', body);
}

function buildBranchEntry(branchId, structuralMaterials, selected, maps) {
  const branch = domainRows.branches.byId.get(branchId);
  const dayStemId = structuralMaterials.dayMaster.stemId;
  const symbolicTemporalRef = `temporal.branch.${branchId}`;
  const hiddenStems = hiddenStemCodesOf(branchId).map(({ orderIndex, stemId, stemCode }) => ({
    orderIndex,
    stemId,
    stemCode,
    tenGodId: tenGodId(dayStemId, stemId),
    hiddenStemProfileId: HIDDEN_STEM_PROFILE_ID,
    orderSemantics: 'profile_table_order_only_no_weight',
  }));
  const elementRelations = [];
  const pairMatches = [];
  const natalOccurrencesByBranch = new Map();
  for (const pillar of Object.values(structuralMaterials.pillars)) {
    const occurrenceRef = `pillar.${pillar.slot}.branch`;
    const factRef = maps.byOccurrence.get(occurrenceRef);
    if (!natalOccurrencesByBranch.has(pillar.branch.branchId)) {
      natalOccurrencesByBranch.set(pillar.branch.branchId, []);
    }
    natalOccurrencesByBranch.get(pillar.branch.branchId).push({ occurrenceRef, factRef });
    const elementBody = {
      version: 'bazi.temporal_branch_element_index_record.v1',
      temporalBranchId: branchId,
      natalOccurrenceRef: occurrenceRef,
      natalBranchId: pillar.branch.branchId,
      temporalToNatalElementRelationId: relationId(
        branch.nominalElementId,
        pillar.branch.nominalElementId,
      ),
      natalToTemporalElementRelationId: relationId(
        pillar.branch.nominalElementId,
        branch.nominalElementId,
      ),
      relationRuleId: 'bazi.fixed_rule.nominal_branch_element_relation.v1',
      directionality: 'explicit_both_directions',
      roleBindings: [
        { role: 'temporal', occurrenceRef: symbolicTemporalRef },
        { role: 'natal', occurrenceRef },
      ],
      sourceFactRefs: [factRef],
      selectedRelationProfileHash: selected.selectedRelationProfileHash,
    };
    elementRelations.push(hashed('bazi.temporal_branch_element_index_record.v1', elementBody));
    for (const rule of pairRuleRows(selected.profile, branchId, pillar.branch.branchId)) {
      const roleBindings = rule.temporalRole === 'source' || rule.temporalRole === 'member_0'
        || rule.temporalRole === 'member_temporal'
        ? [
          { role: rule.temporalRole, occurrenceRef: symbolicTemporalRef },
          { role: rule.natalRole, occurrenceRef },
        ]
        : [
          { role: rule.natalRole, occurrenceRef },
          { role: rule.temporalRole, occurrenceRef: symbolicTemporalRef },
        ];
      const body = {
        version: 'bazi.temporal_branch_pair_index_record.v1',
        temporalBranchId: branchId,
        natalOccurrenceRef: occurrenceRef,
        natalBranchId: pillar.branch.branchId,
        relationRuleId: `bazi.relation_rule.branch_${rule.relationId}.v1`,
        membership: 'complete_membership',
        directionality: rule.directionality,
        roleBindings,
        requiredSymbols: [branchId, pillar.branch.branchId],
        missingRequirements: [],
        sourceFactRefs: [factRef],
        selectedRelationProfileHash: selected.selectedRelationProfileHash,
      };
      pairMatches.push(hashed('bazi.temporal_branch_pair_index_record.v1', body));
    }
  }
  for (const values of natalOccurrencesByBranch.values()) values.sort(
    (a, b) => compareCanonical(a.occurrenceRef, b.occurrenceRef),
  );
  const groupMatches = [];
  for (const group of selected.profile.completeHyperedgeGroups) {
    const temporalRoleIndex = group.memberBranchIds.indexOf(branchId);
    if (temporalRoleIndex < 0) continue;
    const otherSymbols = group.memberBranchIds.filter((symbol) => symbol !== branchId);
    const presentOtherSymbols = otherSymbols.filter((symbol) => natalOccurrencesByBranch.has(symbol));
    if (presentOtherSymbols.length === 0) continue;
    const options = presentOtherSymbols.map((symbol) => natalOccurrencesByBranch.get(symbol));
    for (const participantSelection of cartesian(options)) {
      const bySymbol = new Map(participantSelection.map((item, index) => [
        presentOtherSymbols[index], item,
      ]));
      const missingRequirements = group.memberBranchIds.flatMap((symbol, index) => {
        if (symbol === branchId || bySymbol.has(symbol)) return [];
        return [{
          requiredSymbol: symbol,
          requiredRole: `member_${index}`,
          multiplicity: 1,
          relationRuleId: `bazi.relation_rule.${group.relationId}.${group.id}.v1`,
        }];
      });
      const roleBindings = group.memberBranchIds.flatMap((symbol, index) => {
        if (symbol === branchId) return [{ role: `member_${index}`, occurrenceRef: symbolicTemporalRef }];
        const item = bySymbol.get(symbol);
        return item ? [{ role: `member_${index}`, occurrenceRef: item.occurrenceRef }] : [];
      });
      const sourceFactRefs = participantSelection.map((item) => item.factRef).sort(compareCanonical);
      const body = {
        version: 'bazi.temporal_branch_group_index_record.v1',
        temporalBranchId: branchId,
        groupId: group.id,
        relationRuleId: `bazi.relation_rule.${group.relationId}.${group.id}.v1`,
        membership: missingRequirements.length === 0
          ? 'complete_membership'
          : 'partial_membership',
        directionality: group.relationId === 'punishment_group'
          ? 'ordered_by_profile_roles'
          : 'undirected_hyperedge',
        roleBindings,
        natalOccurrenceRefs: participantSelection.map((item) => item.occurrenceRef),
        requiredSymbols: group.memberBranchIds,
        missingRequirements,
        sourceFactRefs,
        selectedRelationProfileHash: selected.selectedRelationProfileHash,
      };
      groupMatches.push(hashed('bazi.temporal_branch_group_index_record.v1', body));
    }
  }
  elementRelations.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  pairMatches.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  groupMatches.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  const sourceFactRefs = [
    maps.dayMaster.factId,
    ...elementRelations.flatMap((row) => row.sourceFactRefs),
    ...pairMatches.flatMap((row) => row.sourceFactRefs),
    ...groupMatches.flatMap((row) => row.sourceFactRefs),
  ].filter((value, index, list) => list.indexOf(value) === index).sort(compareCanonical);
  const body = {
    version: 'bazi.temporal_branch_index_entry.v1',
    branchId,
    branchCode: branch.code,
    nominalElementId: branch.nominalElementId,
    nominalElementCode: branchElementCodeOf(branchId),
    polarityId: branch.polarityId,
    hiddenStems,
    dayMasterGrowthStage: {
      dayMasterFactRef: maps.dayMaster.factId,
      stageId: growthStageId(dayStemId, branchId),
      growthStageProfileId: GROWTH_STAGE_PROFILE_ID,
    },
    elementRelations,
    pairMatches,
    groupMatches,
    sourceFactRefs,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    hashMetadata: hashMetadata('content_identity', 'bazi.temporal_branch_index_hash_view.v1'),
  };
  return hashed('bazi.temporal_branch_index_entry.v1', body);
}

export function buildTemporalMatchIndexV1({
  canonicalFactGraph,
  structuralMaterials,
  profileScopedRawRelationMatches,
  selectedRelationProfile,
}) {
  const graph = assertCanonicalFactGraph(canonicalFactGraph);
  const rawMatches = assertProfileScopedRawRelationMatches(profileScopedRawRelationMatches);
  const selected = assertSelectedRelationProfile(selectedRelationProfile);
  if (rawMatches.selectedRelationProfileHash !== selected.selectedRelationProfileHash
    || rawMatches.canonicalFactGraphHash !== graph.canonicalFactGraphHash) {
    throw new TypeError('TemporalMatchIndex inputs do not share graph and profile identity');
  }
  const maps = temporalFactMaps(graph);
  const byStem = Object.fromEntries(STEM_IDS.map((stemId) => [
    stemId,
    buildStemEntry(stemId, structuralMaterials, selected, maps),
  ]));
  const byBranch = Object.fromEntries(BRANCH_IDS.map((branchId) => [
    branchId,
    buildBranchEntry(branchId, structuralMaterials, selected, maps),
  ]));
  const byPillar60 = SEXAGENARY_PILLARS.map((pillar) => ({
    sexagenaryIndex: pillar.index,
    pillarId: pillar.id,
    stemId: pillar.stemId,
    branchId: pillar.branchId,
    stemIndexRef: `byStem.${pillar.stemId}`,
    branchIndexRef: `byBranch.${pillar.branchId}`,
  }));
  const body = deepFreeze({
    version: TEMPORAL_MATCH_INDEX_VERSION,
    canonicalFactGraphHash: graph.canonicalFactGraphHash,
    rawRelationMatchSetHash: rawMatches.rawRelationMatchSetHash,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    profileId: selected.profileId,
    profileContentHash: selected.profileContentHash,
    ruleRegistryHash: selected.registryHash,
    deterministicTableManifestHash:
      structuralMaterials.deterministicTableManifestRef.deterministicTableManifestHash,
    sourceFactRefs: graph.facts.map((fact) => fact.factId).sort(compareCanonical),
    byStem,
    byBranch,
    byPillar60,
    hashMetadata: hashMetadata('content_identity', 'bazi.temporal_match_index_hash_view.v1'),
  });
  const result = deepFreeze({
    ...body,
    temporalMatchIndexHash: domainHashV1('bazi.temporal_match_index.v1', body),
  });
  assertNoForbiddenFixedFields(result, 'TemporalMatchIndexV1');
  temporalIndexes.add(result);
  return result;
}

export function captureTemporalMatchIndexV1(value) {
  if (temporalIndexes.has(value)) return value;
  const source = captureExactDataRecord(value, [
    'version', 'canonicalFactGraphHash', 'rawRelationMatchSetHash',
    'selectedRelationProfileHash', 'profileId', 'profileContentHash',
    'ruleRegistryHash', 'deterministicTableManifestHash', 'sourceFactRefs',
    'byStem', 'byBranch', 'byPillar60', 'hashMetadata', 'temporalMatchIndexHash',
  ], 'TemporalMatchIndexV1');
  if (source.version !== TEMPORAL_MATCH_INDEX_VERSION) {
    throw new TypeError('TemporalMatchIndexV1.version is unsupported');
  }
  const captured = captureJsonData(source, 'TemporalMatchIndexV1');
  const { temporalMatchIndexHash, ...body } = captured;
  if (domainHashV1('bazi.temporal_match_index.v1', body) !== temporalMatchIndexHash) {
    throw new TypeError('TemporalMatchIndexV1 hash mismatch');
  }
  if (Object.keys(captured.byStem).length !== 10 || Object.keys(captured.byBranch).length !== 12
    || captured.byPillar60.length !== 60) {
    throw new TypeError('TemporalMatchIndexV1 coverage must be 10 stems, 12 branches and 60 pillars');
  }
  const result = deepFreeze(captured);
  assertNoForbiddenFixedFields(result, 'TemporalMatchIndexV1');
  temporalIndexes.add(result);
  return result;
}

function captureTemporalOccurrence(value, index) {
  const keys = Object.keys(value ?? {});
  const isStem = keys.includes('stemId') && !keys.includes('branchId');
  const isBranch = keys.includes('branchId') && !keys.includes('stemId');
  if (!isStem && !isBranch) {
    throw new TypeError(`temporalOccurrences[${index}] requires exactly one of stemId or branchId`);
  }
  const source = captureExactDataRecord(value, [
    'occurrenceId', 'layer', 'slot', isStem ? 'stemId' : 'branchId', 'sourceTimeRef',
  ], `temporalOccurrences[${index}]`);
  const symbol = isStem
    ? requiredString(source.stemId, `temporalOccurrences[${index}].stemId`)
    : requiredString(source.branchId, `temporalOccurrences[${index}].branchId`);
  if (!(isStem ? STEM_IDS : BRANCH_IDS).includes(symbol)) {
    throw new RangeError(`temporalOccurrences[${index}] symbol is unsupported`);
  }
  return deepFreeze({
    occurrenceId: requiredString(source.occurrenceId, `temporalOccurrences[${index}].occurrenceId`),
    layer: requiredString(source.layer, `temporalOccurrences[${index}].layer`),
    slot: requiredString(source.slot, `temporalOccurrences[${index}].slot`),
    ...(isStem ? { stemId: symbol } : { branchId: symbol }),
    sourceTimeRef: requiredString(source.sourceTimeRef, `temporalOccurrences[${index}].sourceTimeRef`),
  });
}

function materializeMatch(indexed, temporal) {
  const symbolic = temporal.stemId
    ? `temporal.stem.${temporal.stemId}`
    : `temporal.branch.${temporal.branchId}`;
  const roleBindings = indexed.roleBindings.map((binding) => ({
    ...binding,
    occurrenceRef: binding.occurrenceRef === symbolic
      ? temporal.occurrenceId
      : binding.occurrenceRef,
  }));
  const natalOccurrenceRefs = [
    ...(indexed.natalOccurrenceRefs ?? []),
    ...(indexed.natalOccurrenceRef ? [indexed.natalOccurrenceRef] : []),
  ].filter((value, index, list) => list.indexOf(value) === index).sort(compareCanonical);
  const body = {
    version: 'bazi.raw_structural_match.v1',
    relationRuleId: indexed.relationRuleId,
    membership: indexed.membership ?? 'complete_membership',
    directionality: indexed.directionality,
    roleBindings,
    natalOccurrenceRefs,
    temporalOccurrenceRefs: [temporal.occurrenceId],
    missingRequirements: indexed.missingRequirements ?? [],
    supportingFactRefs: indexed.sourceFactRefs,
    sourceTimeRefs: [temporal.sourceTimeRef],
    indexedRecordHash: indexed.contentHash,
    ...(indexed.traditionalCorrespondence ? {
      traditionalCorrespondence: indexed.traditionalCorrespondence,
    } : {}),
  };
  return hashed('bazi.raw_structural_match.v1', body);
}

export function matchTemporalOccurrences(natalFixedState, temporalOccurrencesValue, selectedRelationProfile) {
  if (!natalFixedState || natalFixedState.version !== 'bazi.natal_fixed_state.v1'
    || !/^sha256:[0-9a-f]{64}$/.test(natalFixedState.fixedStateHash ?? '')) {
    throw new TypeError('natalFixedState must be a content-addressed NatalFixedStateV1');
  }
  if (!Array.isArray(temporalOccurrencesValue)) throw new TypeError('temporalOccurrences must be an array');
  const selected = assertSelectedRelationProfile(selectedRelationProfile);
  const index = captureTemporalMatchIndexV1(natalFixedState.temporalMatchIndex);
  if (index.selectedRelationProfileHash !== selected.selectedRelationProfileHash) {
    throw new TypeError('TemporalMatchIndex and selected RelationProfile differ');
  }
  const temporalOccurrences = temporalOccurrencesValue.map(captureTemporalOccurrence);
  const ids = new Set();
  for (const occurrence of temporalOccurrences) {
    if (ids.has(occurrence.occurrenceId)) throw new TypeError('temporal occurrenceId must be unique');
    ids.add(occurrence.occurrenceId);
  }
  const matches = [];
  for (const occurrence of temporalOccurrences) {
    if (occurrence.stemId) {
      const entry = index.byStem[occurrence.stemId];
      for (const row of [...entry.elementRelations, ...entry.ruleMatches]) {
        matches.push(materializeMatch(row, occurrence));
      }
    } else {
      const entry = index.byBranch[occurrence.branchId];
      for (const row of [...entry.elementRelations, ...entry.pairMatches, ...entry.groupMatches]) {
        matches.push(materializeMatch(row, occurrence));
      }
    }
  }
  matches.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  const body = deepFreeze({
    version: RAW_STRUCTURAL_MATCH_SET_VERSION,
    fixedStateHash: natalFixedState.fixedStateHash,
    temporalMatchIndexHash: index.temporalMatchIndexHash,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    temporalOccurrenceCount: temporalOccurrences.length,
    matchCount: matches.length,
    temporalOccurrences,
    matches,
    hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.raw_structural_match_set_hash_view.v1'),
  });
  const result = deepFreeze({
    ...body,
    rawStructuralMatchSetHash: domainHashV1('bazi.raw_structural_match_set.v1', body),
  });
  assertNoForbiddenFixedFields(result, 'RawStructuralMatchSetV1');
  return result;
}
