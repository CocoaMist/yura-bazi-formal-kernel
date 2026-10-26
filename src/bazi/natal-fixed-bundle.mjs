import { BRANCH_IDS, PILLAR_SLOTS, SEXAGENARY_PILLARS } from './constants.mjs';
import {
  BAZI_STRUCTURAL_CODEBOOK_VERSION,
  SEXAGENARY_XUN_VOID_PROFILE,
  SEXAGENARY_XUN_VOID_PROFILE_ID,
} from './foundation-profile.mjs';
import { assertProfileScopedRawRelationMatches, assertNoForbiddenFixedFields, projectProfileScopedRawRelationMatches } from './raw-relation-matches.mjs';
import { buildTemporalMatchIndexV1, captureTemporalMatchIndexV1 } from './temporal-match-index.mjs';
import { assertResolvedReleaseContext, assertSelectedRelationProfile } from '../release/manifest.mjs';
import { captureExactDataRecord, captureJsonData, deepFreeze } from '../shared/assert.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';

export const NATAL_FIXED_BUNDLE_VERSION = 'bazi.natal_fixed_bundle.v1';
export const NATAL_FIXED_STATE_VERSION = 'bazi.natal_fixed_state.v1';
const HASH_PROFILE_ID = 'formal.sha256.domain_separated.v1';
const fixedBundles = new WeakSet();
const fixedStates = new WeakSet();

/**
 * @typedef {object} NatalFixedStateV1
 * @property {'bazi.natal_fixed_state.v1'} version
 * @property {string} fixedStateHash
 * @property {object} coordinates
 * @property {object} canonicalFactGraph
 * @property {object} structuralMaterials
 * @property {object} profileScopedRawRelationMatches
 * @property {object} temporalMatchIndex
 */

/**
 * @typedef {object} NatalFixedBundleV1
 * @property {'bazi.natal_fixed_bundle.v1'} version
 * @property {number} distinctFixedStateCount
 * @property {Record<string, NatalFixedStateV1>} fixedStatesByHash
 * @property {string} bundleHash
 */

function hashMetadata(hashScope, hashViewSchemaVersion) {
  return deepFreeze({ hashProfileId: HASH_PROFILE_ID, hashScope, hashViewSchemaVersion });
}

function assertNestedContentHashes(value, field) {
  if (value == null || typeof value !== 'object') return;
  if (typeof value.version === 'string' && typeof value.contentHash === 'string') {
    const { contentHash, ...body } = value;
    if (domainHashV1(value.version, body) !== contentHash) {
      throw new TypeError(`${field} contains a nested contentHash mismatch`);
    }
  }
  for (const [key, child] of Object.entries(value)) {
    assertNestedContentHashes(child, `${field}.${key}`);
  }
}

function assertNestedFactRefs(value, factIds, field) {
  if (value == null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'sourceFactRefs' || key === 'supportingFactRefs')
      && Array.isArray(child) && child.some((ref) => !factIds.has(ref))) {
      throw new TypeError(`${field}.${key} contains a dangling factRef`);
    }
    if (key === 'dayMasterFactRef' && !factIds.has(child)) {
      throw new TypeError(`${field}.${key} contains a dangling factRef`);
    }
    assertNestedFactRefs(child, factIds, `${field}.${key}`);
  }
}

function projectStructuralMaterials(materials) {
  const body = {
    version: 'bazi.fixed_structural_materials.v1',
    codebookVersion: materials.codebookVersion,
    structuralProfileId: materials.structuralProfileId,
    hiddenStemProfileId: materials.hiddenStemProfileId,
    growthStageProfileId: materials.growthStageProfileId,
    dayMaster: materials.dayMaster,
    pillars: materials.pillars,
    coordinateHash: materials.coordinateHash,
    foundationDependencyHash: materials.foundationDependencyHash,
    factCompilerSemanticsHash: materials.factCompilerSemanticsHash,
    deterministicTableManifestRef: materials.deterministicTableManifestRef,
    sourceStructuralContentHash: materials.contentHash,
    hashMetadata: hashMetadata('content_identity', 'bazi.fixed_structural_materials_hash_view.v1'),
  };
  return deepFreeze({
    ...body,
    fixedStructuralMaterialsHash:
      domainHashV1('bazi.fixed_structural_materials.v1', body),
  });
}

export function natalFixedStateFromCompiledArtifact(artifact, selectedRelationProfile, releaseContext) {
  return buildFixedState(
    artifact,
    assertSelectedRelationProfile(selectedRelationProfile),
    assertResolvedReleaseContext(releaseContext),
  );
}

export function cycleAnchorOf(pillar, slot) {
  const index = SEXAGENARY_PILLARS.findIndex(
    (row) => row.stemId === pillar.stemId && row.branchId === pillar.branchId,
  );
  if (index < 0) throw new TypeError(`invalid sexagenary pillar at ${slot}`);
  const xunStartIndex = Math.floor(index / SEXAGENARY_XUN_VOID_PROFILE.xunSize)
    * SEXAGENARY_XUN_VOID_PROFILE.xunSize;
  const xunStart = SEXAGENARY_PILLARS[xunStartIndex];
  const xunStartBranchIndex = BRANCH_IDS.indexOf(xunStart.branchId);
  return deepFreeze({
    slot,
    stemId: pillar.stemId,
    branchId: pillar.branchId,
    sexagenaryIndex: index,
    xunIndex: Math.floor(index / SEXAGENARY_XUN_VOID_PROFILE.xunSize),
    xunId: `xun:${xunStart.id}`,
    xunStartPillarId: xunStart.id,
    voidBranchIds: [
      ...SEXAGENARY_XUN_VOID_PROFILE.voidBranchOffsetsFromXunStart.map((offset) =>
        BRANCH_IDS[(xunStartBranchIndex + offset)
          % SEXAGENARY_XUN_VOID_PROFILE.branchCycleSize]),
    ],
    calculationIdentity: SEXAGENARY_XUN_VOID_PROFILE_ID,
  });
}

function coordinateProjection(artifact) {
  const pillars = artifact.candidateSnapshot.snapshot.pillars;
  return deepFreeze({
    version: 'bazi.natal_fixed_coordinate_projection.v1',
    coordinateHash: artifact.coordinateHash,
    pillars,
    pillarCode24: artifact.pillarCode24,
    index19: artifact.denseRank.index19,
    encoding: artifact.encoding,
    denseRank: artifact.denseRank,
    pillarCodes: Object.fromEntries(PILLAR_SLOTS.map((slot, index) => [slot, {
      stemCode: artifact.structuralMaterials.pillars[slot].stem.stemCode,
      branchCode: artifact.structuralMaterials.pillars[slot].branch.branchCode,
      sexagenaryIndex: SEXAGENARY_PILLARS.findIndex((row) =>
        row.stemId === pillars[slot].stemId && row.branchId === pillars[slot].branchId),
    }])),
    fixedPillarPositionPairs: [
      ['year', 'month'], ['year', 'day'], ['year', 'hour'],
      ['month', 'day'], ['month', 'hour'], ['day', 'hour'],
    ].map(([left, right]) => ({
      pairId: `${left}_${right}`,
      leftPillarPosition: left,
      rightPillarPosition: right,
      leftStemOccurrenceRef: `pillar.${left}.visible_stem`,
      rightStemOccurrenceRef: `pillar.${right}.visible_stem`,
      leftBranchOccurrenceRef: `pillar.${left}.branch`,
      rightBranchOccurrenceRef: `pillar.${right}.branch`,
    })),
    cycleAnchors: Object.fromEntries(PILLAR_SLOTS.map((slot) => [
      slot,
      cycleAnchorOf(pillars[slot], slot),
    ])),
  });
}

function buildFixedState(artifact, selected, releaseContext) {
  const rawMatches = projectProfileScopedRawRelationMatches(
    artifact.profileScopedStructuralCandidateSet,
  );
  const structuralMaterials = projectStructuralMaterials(artifact.structuralMaterials);
  const temporalMatchIndex = buildTemporalMatchIndexV1({
    canonicalFactGraph: artifact.canonicalFactGraph,
    structuralMaterials,
    profileScopedRawRelationMatches: rawMatches,
    selectedRelationProfile: selected,
  });
  const body = deepFreeze({
    version: NATAL_FIXED_STATE_VERSION,
    coordinates: coordinateProjection(artifact),
    canonicalFactGraph: artifact.canonicalFactGraph,
    structuralMaterials,
    profileScopedRawRelationMatches: rawMatches,
    temporalMatchIndex,
    fixedDependencies: {
      deterministicTableManifestHash:
        releaseContext.componentHashes.deterministicTableManifestHash,
      structuralCodebookVersion: BAZI_STRUCTURAL_CODEBOOK_VERSION,
      hiddenStemProfileId: structuralMaterials.hiddenStemProfileId,
      growthStageProfileId: structuralMaterials.growthStageProfileId,
      sexagenaryXunVoidProfileId: SEXAGENARY_XUN_VOID_PROFILE_ID,
      factCompilerSemanticsHash: structuralMaterials.factCompilerSemanticsHash,
      canonicalEncodingProfileHash:
        releaseContext.componentHashes.canonicalEncodingProfileHash,
      hashingProfileHash: releaseContext.componentHashes.hashingProfileHash,
      selectedRelationProfileHash: selected.selectedRelationProfileHash,
      profileContentHash: selected.profileContentHash,
      ruleRegistryHash: selected.registryHash,
      structuralCandidateEnumeratorHash:
        releaseContext.componentHashes.structuralCandidateEnumeratorHash,
    },
    hashMetadata: hashMetadata('content_identity', 'bazi.natal_fixed_state_hash_view.v1'),
  });
  const state = deepFreeze({
    ...body,
    fixedStateHash: domainHashV1('bazi.natal_fixed_state.v1', body),
  });
  assertNoForbiddenFixedFields(state, 'NatalFixedStateV1');
  fixedStates.add(state);
  return state;
}

function sourceProjectionDerivations(candidate, fixedStateRef) {
  return PILLAR_SLOTS.map((slot) => {
    const body = {
      version: 'bazi.source_projection_derivation.v1',
      derivationKind: 'source_projection',
      sourceArtifactRef: candidate.snapshotHash,
      sourcePath: `$.snapshot.pillars.${slot}`,
      targetFixedStateRef: fixedStateRef,
      targetFactRef: `fact:root_pillar:${slot}`,
      hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.source_projection_derivation_hash_view.v1'),
    };
    return deepFreeze({
      ...body,
      derivationHash: domainHashV1('bazi.source_projection_derivation.v1', body),
    });
  });
}

function pathBinding(candidate, result, fixedStateRef, calendarResolution) {
  const sourceProjections = fixedStateRef == null
    ? []
    : sourceProjectionDerivations(candidate, fixedStateRef);
  const body = {
    version: 'bazi.natal_fixed_path_binding.v1',
    candidateOrdinal: candidate.candidateOrdinal,
    candidateId: candidate.candidateId,
    candidateSnapshotHash: candidate.snapshotHash,
    candidateDecisionPathRef: candidate.candidateDecisionPathRef,
    candidateSnapshotRef: {
      snapshotId: candidate.snapshot.snapshotId,
      subjectRef: candidate.snapshot.subjectRef,
      validTimeRef: candidate.snapshot.validTimeRef,
      provenanceRef: candidate.snapshot.provenanceRef,
    },
    calendarResolutionHash: calendarResolution.resolutionHash,
    compilationStatus: result.status,
    resultHash: result.resultHash,
    fixedStateRef,
    sourceProjectionDerivations: sourceProjections,
    hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.natal_fixed_path_binding_hash_view.v1'),
  };
  return deepFreeze({
    ...body,
    pathBindingHash: domainHashV1('bazi.natal_fixed_path_binding.v1', body),
  });
}

export function buildNatalFixedBundleV1({
  input,
  calendarArtifacts,
  calendarResolutions,
  compilationRequest,
  compilationBatch,
  releaseContext,
  selectedRelationProfile,
}) {
  const context = assertResolvedReleaseContext(releaseContext);
  const selected = assertSelectedRelationProfile(selectedRelationProfile);
  if (selected.releaseManifestHash !== context.releaseManifestHash
    || compilationBatch.releaseManifestHash !== context.releaseManifestHash
    || compilationRequest.activeProfileId !== selected.profileId) {
    throw new TypeError('NatalFixedBundle inputs do not share admitted release and profile identity');
  }
  if (!Array.isArray(calendarResolutions)
    || calendarResolutions.length !== calendarArtifacts.candidateSnapshotSet.candidateCount
    || compilationBatch.resultCount !== calendarArtifacts.candidateSnapshotSet.candidateCount) {
    throw new TypeError('NatalFixedBundle path, candidate and result counts differ');
  }
  const fixedStateMap = new Map();
  const pathBindings = [];
  for (let index = 0; index < calendarArtifacts.candidateSnapshotSet.candidateCount; index += 1) {
    const candidate = calendarArtifacts.candidateSnapshotSet.candidates[index];
    const result = compilationBatch.results[index];
    let fixedStateRef = null;
    if (result.status === 'compiled') {
      const state = buildFixedState(result.artifact, selected, context);
      fixedStateRef = state.fixedStateHash;
      if (!fixedStateMap.has(fixedStateRef)) fixedStateMap.set(fixedStateRef, state);
    }
    pathBindings.push(pathBinding(
      candidate,
      result,
      fixedStateRef,
      calendarResolutions[index],
    ));
  }
  const fixedStatesByHash = Object.fromEntries([...fixedStateMap.entries()].sort(
    ([left], [right]) => compareCanonical(left, right),
  ));
  const candidatePaths = calendarArtifacts.calendarDecisionTrace.candidatePaths.map(
    (path, index) => ({
      ...path,
      calendarResolution: {
        version: calendarResolutions[index].version,
        resolutionHash: calendarResolutions[index].resolutionHash,
        request: calendarResolutions[index].request,
        provider: calendarResolutions[index].provider,
        resolvedInstantMs: calendarResolutions[index].resolved.atMs,
        resolvedInstantIso: calendarResolutions[index].resolved.at,
        resolvedProvenance: calendarResolutions[index].resolved.provenance,
      },
    }),
  );
  const body = deepFreeze({
    version: NATAL_FIXED_BUNDLE_VERSION,
    subjectContext: {
      subjectRef: input.subjectRef,
      birthInput: input.birth,
      inputFactHash: calendarArtifacts.candidateSnapshotSet.inputFactHash,
      precisionPolicy: input.precisionPolicy,
      traditionalSexClass: input.birth.traditionalSexClass,
    },
    calendarResolution: {
      resolutionEnvelope: calendarArtifacts.calendarResolutionEnvelope,
      calendarDecisionTraceHash:
        calendarArtifacts.calendarDecisionTrace.calendarDecisionTraceHash,
      candidatePaths,
    },
    release: {
      releaseManifestHash: context.releaseManifestHash,
      engineVersion: context.engine.version,
      selectedRelationProfileHash: selected.selectedRelationProfileHash,
      profileId: selected.profileId,
      profileContentHash: selected.profileContentHash,
      ruleRegistryHash: selected.registryHash,
    },
    sourceCompilation: {
      requestHash: compilationRequest.requestHash,
      natalCompilationBatchHash: compilationBatch.natalCompilationBatchHash,
      candidateSnapshotSetHash:
        calendarArtifacts.candidateSnapshotSet.candidateSnapshotSetHash,
      resultHashes: compilationBatch.resultHashes,
    },
    distinctFixedStateCount: fixedStateMap.size,
    pathCount: pathBindings.length,
    pathBindings,
    fixedStatesByHash,
    audit: {
      calendarPathsRetained: pathBindings.length,
      distinctFixedStates: fixedStateMap.size,
      canonicalFactGraphPhysicalCopies: fixedStateMap.size,
      factRefsClosed: true,
      derivationRefsClosed: true,
      sourceRefsClosed: true,
      interpretationFieldsExcluded: true,
    },
    hashMetadata: hashMetadata('compiled_artifact', 'bazi.natal_fixed_bundle_hash_view.v1'),
  });
  const bundle = deepFreeze({
    ...body,
    bundleHash: domainHashV1('bazi.natal_fixed_bundle.v1', body),
  });
  assertNatalFixedBundleV1(bundle);
  fixedBundles.add(bundle);
  return bundle;
}

export function captureNatalFixedStateV1(value) {
  const captured = captureJsonData(value, 'NatalFixedStateV1');
  if (captured.version !== NATAL_FIXED_STATE_VERSION) {
    throw new TypeError('NatalFixedStateV1.version is unsupported');
  }
  const { fixedStateHash, ...body } = captured;
  if (domainHashV1('bazi.natal_fixed_state.v1', body) !== fixedStateHash) {
    throw new TypeError('NatalFixedStateV1 hash mismatch');
  }
  captureTemporalMatchIndexV1(captured.temporalMatchIndex);
  const rawMatches = captured.profileScopedRawRelationMatches;
  if (rawMatches.version !== 'bazi.profile_scoped_raw_relation_matches.v1'
    || rawMatches.matchCount !== rawMatches.matches.length) {
    throw new TypeError('NatalFixedStateV1 raw relation match cardinality is invalid');
  }
  const { rawRelationMatchSetHash, ...rawMatchBody } = rawMatches;
  if (domainHashV1('bazi.profile_scoped_raw_relation_matches.v1', rawMatchBody)
    !== rawRelationMatchSetHash) {
    throw new TypeError('NatalFixedStateV1 raw relation match set hash mismatch');
  }
  if (rawMatches.canonicalFactGraphHash !== captured.canonicalFactGraph.canonicalFactGraphHash
    || captured.temporalMatchIndex.canonicalFactGraphHash
      !== captured.canonicalFactGraph.canonicalFactGraphHash
    || captured.temporalMatchIndex.rawRelationMatchSetHash !== rawRelationMatchSetHash
    || captured.temporalMatchIndex.selectedRelationProfileHash
      !== rawMatches.selectedRelationProfileHash) {
    throw new TypeError('NatalFixedStateV1 graph, raw relation and temporal index identity differ');
  }
  assertNestedContentHashes(rawMatches, 'NatalFixedStateV1.profileScopedRawRelationMatches');
  assertNestedContentHashes(captured.temporalMatchIndex, 'NatalFixedStateV1.temporalMatchIndex');
  const factIds = new Set(captured.canonicalFactGraph.facts.map((fact) => fact.factId));
  const derivationHashes = new Set(
    captured.canonicalFactGraph.derivations.map((derivation) => derivation.derivationHash),
  );
  for (const fact of captured.canonicalFactGraph.facts) {
    if (fact.inputFactRefs.some((ref) => !factIds.has(ref))) {
      throw new TypeError('NatalFixedStateV1 contains a dangling factRef');
    }
    if (fact.derivationRefs.some((ref) => !derivationHashes.has(ref))) {
      throw new TypeError('NatalFixedStateV1 contains a dangling derivationRef');
    }
  }
  assertNestedFactRefs(rawMatches, factIds, 'NatalFixedStateV1.profileScopedRawRelationMatches');
  assertNestedFactRefs(captured.temporalMatchIndex, factIds, 'NatalFixedStateV1.temporalMatchIndex');
  assertNoForbiddenFixedFields(captured, 'NatalFixedStateV1');
  const state = deepFreeze(captured);
  fixedStates.add(state);
  return state;
}

export function assertNatalFixedBundleV1(value) {
  const captured = fixedBundles.has(value) ? value : captureJsonData(value, 'NatalFixedBundleV1');
  if (captured.version !== NATAL_FIXED_BUNDLE_VERSION) {
    throw new TypeError('NatalFixedBundleV1.version is unsupported');
  }
  const { bundleHash, ...body } = captured;
  if (domainHashV1('bazi.natal_fixed_bundle.v1', body) !== bundleHash) {
    throw new TypeError('NatalFixedBundleV1 hash mismatch');
  }
  const stateHashes = Object.keys(captured.fixedStatesByHash);
  if (captured.distinctFixedStateCount !== stateHashes.length) {
    throw new TypeError('NatalFixedBundleV1 distinctFixedStateCount mismatch');
  }
  for (const hash of stateHashes) {
    const state = captureNatalFixedStateV1(captured.fixedStatesByHash[hash]);
    if (state.fixedStateHash !== hash) throw new TypeError('fixedStatesByHash key mismatch');
  }
  if (captured.pathBindings.length !== captured.pathCount
    || captured.pathBindings.some((binding) => binding.fixedStateRef != null
      && !Object.hasOwn(captured.fixedStatesByHash, binding.fixedStateRef))) {
    throw new TypeError('NatalFixedBundleV1 path binding closure failed');
  }
  for (const binding of captured.pathBindings.filter((item) => item.fixedStateRef != null)) {
    const targetState = captured.fixedStatesByHash[binding.fixedStateRef];
    const factIds = new Set(targetState.canonicalFactGraph.facts.map((fact) => fact.factId));
    if (binding.sourceProjectionDerivations.length !== PILLAR_SLOTS.length
      || binding.sourceProjectionDerivations.some((derivation) =>
        derivation.derivationKind !== 'source_projection'
        || derivation.sourceArtifactRef !== binding.candidateSnapshotHash
        || !factIds.has(derivation.targetFactRef))) {
      throw new TypeError('NatalFixedBundleV1 root source projection closure failed');
    }
  }
  for (const binding of captured.pathBindings) {
    const { pathBindingHash, ...bindingBody } = binding;
    if (domainHashV1('bazi.natal_fixed_path_binding.v1', bindingBody) !== pathBindingHash) {
      throw new TypeError('NatalFixedBundleV1 pathBindingHash mismatch');
    }
    if ((binding.compilationStatus === 'compiled') !== (binding.fixedStateRef != null)) {
      throw new TypeError('NatalFixedBundleV1 compilation status and fixedStateRef differ');
    }
    for (const derivation of binding.sourceProjectionDerivations) {
      const { derivationHash, ...derivationBody } = derivation;
      if (domainHashV1('bazi.source_projection_derivation.v1', derivationBody) !== derivationHash
        || derivation.targetFixedStateRef !== binding.fixedStateRef) {
        throw new TypeError('NatalFixedBundleV1 source projection derivation hash or target mismatch');
      }
    }
  }
  assertNoForbiddenFixedFields(captured, 'NatalFixedBundleV1');
  return value;
}
