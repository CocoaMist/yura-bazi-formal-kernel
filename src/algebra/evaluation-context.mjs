import { assertCanonicalFactGraph, buildFactView } from '../bazi/fact-graph.mjs';
import {
  assertCompiledNatalArtifact,
} from '../bazi/kernel.mjs';
import { buildBranchKey } from '../state/contracts.mjs';
import { captureExactDataRecord, requiredString, stringArray } from '../shared/assert.mjs';
import { contentHashV1 } from '../shared/canonical.mjs';

export const EVALUATION_CONTEXT_VERSION = 'formal.evaluation_context.v4';
export const OVERLAY_FACT_GRAPH_VERSION = 'formal.overlay_fact_graph.v2';
export const EVALUATION_SCOPES = Object.freeze(['natal', 'temporal']);

const overlayFactGraphs = new WeakSet();

export function buildOverlayFactGraph(input = {}) {
  const source = captureExactDataRecord(input, [
    'factGraph',
    'natalFoundationDependencyHash',
  ], 'OverlayFactGraph');
  const factGraph = assertCanonicalFactGraph(source.factGraph, 'OverlayFactGraph.factGraph');
  const natalFoundationDependencyHash = requiredString(
    source.natalFoundationDependencyHash,
    'OverlayFactGraph.natalFoundationDependencyHash',
  );
  const body = Object.freeze({
    version: OVERLAY_FACT_GRAPH_VERSION,
    natalFoundationDependencyHash,
    canonicalFactGraphHash: factGraph.canonicalFactGraphHash,
  });
  const overlay = Object.freeze({
    ...body,
    factGraph,
    overlayFactGraphHash: contentHashV1(body),
  });
  overlayFactGraphs.add(overlay);
  return overlay;
}

function assertOverlayFactGraph(value) {
  if (!value || typeof value !== 'object' || !overlayFactGraphs.has(value)) {
    throw new TypeError('EvaluationContext.overlayFactGraph must be a factory-produced OverlayFactGraph');
  }
  return value;
}

// EvaluationContext is data only. RuleExecutionPlan remains a separate input to
// the future RuleEvaluator; the context never emits a witness by itself.
export function buildEvaluationContext(input = {}) {
  const source = captureExactDataRecord(input, [
    'selectedArtifact',
    'overlayFactGraph',
    'branchKey',
    'allowedReleaseManifestHashes',
    'engineVersion',
  ], 'EvaluationContext');
  const selectedArtifact = assertCompiledNatalArtifact(
    source.selectedArtifact,
    'EvaluationContext.selectedArtifact',
  );
  const natalGraph = selectedArtifact.canonicalFactGraph;
  const profileScopedCandidateSet = selectedArtifact.profileScopedStructuralCandidateSet;
  const overlayFactGraph = source.overlayFactGraph == null
    ? null
    : assertOverlayFactGraph(source.overlayFactGraph);
  if (overlayFactGraph !== null
    && overlayFactGraph.natalFoundationDependencyHash !== selectedArtifact.foundationDependencyHash) {
    throw new TypeError('OverlayFactGraph natalFoundationDependencyHash does not match selected Artifact');
  }
  const branchKey = buildBranchKey(source.branchKey);
  const allowedReleaseManifestHashes = stringArray(
    source.allowedReleaseManifestHashes,
    'EvaluationContext.allowedReleaseManifestHashes',
  );
  if (!allowedReleaseManifestHashes.includes(selectedArtifact.releaseManifestHash)) {
    throw new TypeError('selected Artifact releaseManifestHash is not allowed for this evaluation');
  }
  const engineVersion = requiredString(source.engineVersion, 'EvaluationContext.engineVersion');
  const natalHash = natalGraph.canonicalFactGraphHash;
  const candidateSetHash = profileScopedCandidateSet.structuralCandidateSetHash;
  const overlayHash = overlayFactGraph === null ? null : overlayFactGraph.overlayFactGraphHash;
  const selectedCompiledArtifactRef = Object.freeze({
    compiledArtifactId: selectedArtifact.compiledNatalArtifactHash,
    candidateId: selectedArtifact.candidateId,
    candidateSnapshotHash: selectedArtifact.candidateSnapshotHash,
    candidateDecisionPathRef: selectedArtifact.candidateDecisionPathRef,
    canonicalFactGraphHash: selectedArtifact.canonicalFactGraphHash,
    structuralCandidateSetHash: selectedArtifact.structuralCandidateSetHash,
    foundationDependencyHash: selectedArtifact.foundationDependencyHash,
    releaseManifestHash: selectedArtifact.releaseManifestHash,
    provenanceRoot: selectedArtifact.provenanceRoot,
  });
  const contextHash = contentHashV1({
    version: EVALUATION_CONTEXT_VERSION,
    natalHash,
    candidateSetHash,
    overlayHash,
    branchHash: branchKey.branchHash,
    selectedCompiledArtifactRef,
    allowedReleaseManifestHashes,
    engineVersion,
  });
  const natalView = buildFactView(natalGraph);
  const overlayView = overlayFactGraph === null ? null : buildFactView(overlayFactGraph.factGraph);
  return Object.freeze({
    version: EVALUATION_CONTEXT_VERSION,
    authority: 'candidate',
    admissionStatus: 'candidate',
    branchKey,
    natalHash,
    candidateSetHash,
    overlayHash,
    selectedCompiledArtifactRef,
    allowedReleaseManifestHashes,
    engineVersion,
    contextHash,
    analysisContextHash: contextHash,
    scopes: Object.freeze(overlayFactGraph === null ? ['natal'] : [...EVALUATION_SCOPES]),
    profileScopedCandidateSet,
    viewOf: (scope) => {
      if (scope === 'natal') return natalView;
      if (scope === 'temporal') return overlayView;
      throw new RangeError(`unknown evaluation scope: ${String(scope)}`);
    },
    describeCacheKey: () => Object.freeze({
      natalHash,
      candidateSetHash,
      overlayHash,
      branchHash: branchKey.branchHash,
      selectedCompiledArtifactRef,
      allowedReleaseManifestHashes,
      engineVersion,
      contextHash,
      analysisContextHash: contextHash,
    }),
  });
}
