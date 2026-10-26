import {
  DIRECT_PILLAR_ENCODING_VERSION,
  GRAMMAR_STATE_COUNT,
  GRAMMAR_STATE_INDEX_VERSION,
  buildValidatedPillarCoordinate,
} from './encoding.mjs';
import { compileRelationMaterials, compileStructuralMaterials } from './materials.mjs';
import { buildCanonicalFactGraphFromMaterials } from './fact-graph.mjs';
import { buildProfileScopedStructuralCandidateSet } from './candidates.mjs';
import {
  canonicalResultOrder,
  validateCandidateSnapshotV1,
  validateNatalCompilationInputs,
} from './compilation-contracts.mjs';
import {
  assertResolvedReleaseContext,
  resolveSelectedRelationProfile,
} from '../release/manifest.mjs';
import { deepFreeze } from '../shared/assert.mjs';
import { domainHashV1 } from '../shared/canonical.mjs';

export const BAZI_FORMAL_KERNEL_VERSION = 'bazi.formal_kernel.v7';
export const COMPILED_NATAL_ARTIFACT_VERSION = 'bazi.compiled_natal_artifact.v2';
export const CANDIDATE_COMPILATION_RESULT_VERSION = 'bazi.candidate_compilation_result.v2';
export const NATAL_COMPILATION_BATCH_VERSION = 'bazi.natal_compilation_batch.v2';
export const CANDIDATE_COMPILATION_STATUSES = Object.freeze([
  'compiled', 'validation_failed', 'compilation_failed', 'internal_error',
]);

const compiledNatalArtifacts = new WeakSet();

function phaseHook(hooks, phase, candidate) {
  if (hooks?.onPhase) hooks.onPhase(phase, candidate);
}

function compileCandidateTransaction(candidate, releaseContext, selectedProfile, tracker, hooks) {
  let phase = 'snapshot_validation';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const validated = validateCandidateSnapshotV1(candidate);
  const snapshot = validated.normalizedChartSnapshot;

  phase = 'coordinate_construction';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const coordinate = buildValidatedPillarCoordinate(snapshot.pillars);

  phase = 'code_index_encoding';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const encoding = deepFreeze({
    version: DIRECT_PILLAR_ENCODING_VERSION,
    pillarCode24: coordinate.pillarCode24,
  });
  const denseRank = deepFreeze({
    version: GRAMMAR_STATE_INDEX_VERSION,
    index19: coordinate.index19,
    stateCount: GRAMMAR_STATE_COUNT,
  });

  phase = 'p1_fact_compilation';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const structuralMaterials = compileStructuralMaterials(
    coordinate,
    releaseContext,
    candidate.snapshotHash,
  );

  phase = 'canonical_graph_construction';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const canonicalFactGraph = buildCanonicalFactGraphFromMaterials({
    coordinate,
    structuralMaterials,
  });

  phase = 'p2_candidate_enumeration';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const relationMaterials = compileRelationMaterials(
    coordinate,
    selectedProfile,
    candidate.snapshotHash,
  );
  const profileScopedStructuralCandidateSet = buildProfileScopedStructuralCandidateSet({
    relationMaterials,
    selectedRelationProfile: selectedProfile,
    factGraph: canonicalFactGraph,
    releaseContext,
  });

  phase = 'canonical_serialization';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const compilerIdentity = deepFreeze({
    kernelVersion: BAZI_FORMAL_KERNEL_VERSION,
    factCompilerSemanticsHash: structuralMaterials.factCompilerSemanticsHash,
    structuralCandidateEnumeratorHash:
      releaseContext.componentHashes.structuralCandidateEnumeratorHash,
  });

  phase = 'hash_generation';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const provenanceBody = {
    version: 'bazi.natal_provenance_root.v2',
    candidateId: candidate.candidateId,
    candidateOrdinal: candidate.candidateOrdinal,
    candidateSnapshotHash: candidate.snapshotHash,
    candidateDecisionPathRef: candidate.candidateDecisionPathRef,
    coordinateHash: coordinate.coordinateHash,
    foundationDependencyHash: structuralMaterials.foundationDependencyHash,
    canonicalFactGraphHash: canonicalFactGraph.canonicalFactGraphHash,
    structuralCandidateSetHash:
      profileScopedStructuralCandidateSet.structuralCandidateSetHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
  };
  const provenanceRoot = domainHashV1('bazi.natal_provenance_root.v2', provenanceBody);

  phase = 'artifact_finalization';
  tracker.phase = phase;
  phaseHook(hooks, phase, candidate);
  const artifactBody = deepFreeze({
    version: COMPILED_NATAL_ARTIFACT_VERSION,
    candidateId: candidate.candidateId,
    candidateOrdinal: candidate.candidateOrdinal,
    candidateSnapshotHash: candidate.snapshotHash,
    candidateDecisionPathRef: candidate.candidateDecisionPathRef,
    coordinateHash: coordinate.coordinateHash,
    pillarCode24: coordinate.pillarCode24,
    denseRank,
    encoding,
    foundationDependencyHash: structuralMaterials.foundationDependencyHash,
    canonicalFactGraphHash: canonicalFactGraph.canonicalFactGraphHash,
    structuralCandidateSetHash:
      profileScopedStructuralCandidateSet.structuralCandidateSetHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    selectedRelationProfile: {
      version: selectedProfile.version,
      profileId: selectedProfile.profileId,
      profileSchemaVersion: selectedProfile.profileSchemaVersion,
      profileContentHash: selectedProfile.profileContentHash,
      registryHash: selectedProfile.registryHash,
      selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    },
    compilerIdentity,
    provenanceRoot,
    candidateSnapshot: candidate,
    canonicalFactGraph,
    profileScopedStructuralCandidateSet,
    structuralMaterials,
    relationMaterials,
  });
  const artifact = deepFreeze({
    ...artifactBody,
    compiledNatalArtifactHash:
      domainHashV1('bazi.compiled_natal_artifact.v2', artifactBody),
  });
  compiledNatalArtifacts.add(artifact);
  return { artifact, phase };
}

export function assertCompiledNatalArtifact(value, field = 'CompiledNatalArtifactV2') {
  if (!value || typeof value !== 'object' || !compiledNatalArtifacts.has(value)) {
    throw new TypeError(`${field} must be a factory-produced CompiledNatalArtifactV2`);
  }
  return value;
}

function stableErrorCode(status, phase, error) {
  const category = error instanceof RangeError ? 'range'
    : error instanceof TypeError ? 'type'
      : 'runtime';
  return `bazi.${status}.${phase}.${category}`;
}

function failureResult(candidate, request, releaseContext, selectedProfile, phase, error) {
  const stableDomainError = error instanceof TypeError || error instanceof RangeError;
  const status = phase === 'snapshot_validation' && stableDomainError
    ? 'validation_failed'
    : (stableDomainError
      ? 'compilation_failed'
      : 'internal_error');
  const stableCode = stableErrorCode(status, phase, error);
  const deterministic = status !== 'internal_error';
  const diagnosticHash = domainHashV1('bazi.candidate_failure_diagnostic.v1', {
    stableErrorCode: stableCode,
    failedPhase: phase,
    errorName: error?.name ?? 'Error',
    ...(deterministic ? { stableMessage: error?.message ?? String(error) } : {}),
  });
  const body = deepFreeze({
    version: CANDIDATE_COMPILATION_RESULT_VERSION,
    status,
    candidateOrdinal: candidate.candidateOrdinal,
    candidateId: candidate.candidateId,
    snapshotHash: candidate.snapshotHash,
    requestHash: request.requestHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    failedPhase: phase,
    stableErrorCode: stableCode,
    diagnosticHash,
    retryable: status === 'internal_error',
    deterministic,
  });
  return deepFreeze({
    ...body,
    resultHash: domainHashV1('bazi.candidate_compilation_result.v2', body),
    diagnostics: deepFreeze({
      errorName: error?.name ?? 'Error',
      message: error?.message ?? String(error),
    }),
  });
}

function successResult(artifact, request, releaseContext, selectedProfile) {
  assertCompiledNatalArtifact(artifact);
  const body = deepFreeze({
    version: CANDIDATE_COMPILATION_RESULT_VERSION,
    status: 'compiled',
    candidateOrdinal: artifact.candidateOrdinal,
    candidateId: artifact.candidateId,
    snapshotHash: artifact.candidateSnapshotHash,
    requestHash: request.requestHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    artifact,
  });
  return deepFreeze({
    ...body,
    resultHash: domainHashV1('bazi.candidate_compilation_result.v2', body),
  });
}

export function compileNatalRequestWithHooks(
  requestValue,
  candidateSetValue,
  traceValue,
  releaseContextValue,
  hooks = null,
) {
  const releaseContext = assertResolvedReleaseContext(releaseContextValue);
  const { request, candidateSet, trace } = validateNatalCompilationInputs(
    requestValue,
    candidateSetValue,
    traceValue,
    releaseContext,
  );
  const selectedProfile = resolveSelectedRelationProfile(
    releaseContext,
    request.activeProfileId,
  );
  const results = canonicalResultOrder(candidateSet.candidates.map((candidate) => {
    const tracker = { phase: 'snapshot_validation' };
    try {
      phaseHook(hooks, 'candidate_transaction_start', candidate);
      const compiled = compileCandidateTransaction(
        candidate,
        releaseContext,
        selectedProfile,
        tracker,
        hooks,
      );
      return successResult(compiled.artifact, request, releaseContext, selectedProfile);
    } catch (error) {
      return failureResult(
        candidate,
        request,
        releaseContext,
        selectedProfile,
        tracker.phase,
        error,
      );
    }
  }));
  return finalizeNatalCompilationBatch({
    request,
    candidateSet,
    trace,
    releaseContext,
    selectedProfile,
    results,
  });
}

export function finalizeNatalCompilationBatch({
  request,
  candidateSet,
  trace,
  releaseContext,
  selectedProfile,
  results: unorderedResults,
}) {
  const results = canonicalResultOrder(unorderedResults);
  const counts = Object.fromEntries(CANDIDATE_COMPILATION_STATUSES.map(
    (status) => [status, results.filter((result) => result.status === status).length],
  ));
  const batchStatus = results.length === 0 ? 'empty'
    : counts.compiled === results.length ? 'compiled'
      : counts.compiled === 0 ? 'failed' : 'partial_failure';
  const batchIdentity = deepFreeze({
    version: NATAL_COMPILATION_BATCH_VERSION,
    requestHash: request.requestHash,
    inputFactHash: candidateSet.inputFactHash,
    calendarDecisionTraceHash: trace.calendarDecisionTraceHash,
    candidateSnapshotSetHash: candidateSet.candidateSnapshotSetHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    inputCount: candidateSet.candidateCount,
    resultCount: results.length,
    status: batchStatus,
    counts,
    resultHashes: results.map((result) => result.resultHash),
  });
  if (batchIdentity.inputCount !== batchIdentity.resultCount) {
    throw new Error('NatalCompilationBatch total-map cardinality invariant violated');
  }
  return deepFreeze({
    ...batchIdentity,
    results,
    natalCompilationBatchHash:
      domainHashV1('bazi.natal_compilation_batch.v2', batchIdentity),
    ...(request.metadata == null ? {} : { requestMetadata: request.metadata }),
  });
}

export function compileNatalRequest(
  requestValue,
  candidateSetValue,
  traceValue,
  releaseContextValue,
) {
  return compileNatalRequestWithHooks(
    requestValue,
    candidateSetValue,
    traceValue,
    releaseContextValue,
  );
}
