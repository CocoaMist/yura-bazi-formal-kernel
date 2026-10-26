import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
  TEMPORAL_KERNEL_REQUEST_VERSION,
  TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
  admitReleaseManifestV2,
  assertNatalFixedBundleV1,
  buildTemporalKernelRequestV1,
  buildTemporalLayerCandidateSetV1,
  canonicalJsonV1,
  compileTemporalRequest,
  domainHashV1,
} from '../src/index.mjs';
import {
  REFERENCE_CALENDAR_PROVIDER,
  buildCenturyTemporalCandidatesV1,
  buildLifeStageTimeline,
} from '../capabilities/src/index.mjs';
import { captureExactDataRecord, captureJsonData, deepFreeze } from '../src/shared/assert.mjs';

const REQUEST_VERSION = 'yuracore.century_temporal_compile_request.v1';
const BUNDLE_VERSION = 'yuracore.century_temporal_bundle.v1';
const ERROR_VERSION = 'yuracore.century_temporal_error.v1';

function parseInput(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('stdin must contain one JSON object');
  }
  return captureExactDataRecord(value, [
    'version', 'natalFixedBundle', 'natalFixedBundlePath',
    'releaseManifest', 'releaseManifestPath', 'centuryPlan',
  ], 'CenturyTemporalCompileRequestV1');
}

async function readJsonChoice(input, inlineField, pathField, defaultPath = null) {
  const hasInline = Object.hasOwn(input, inlineField);
  const hasPath = Object.hasOwn(input, pathField);
  if (hasInline && hasPath) throw new TypeError(`${inlineField} and ${pathField} are mutually exclusive`);
  if (hasInline) return captureJsonData(input[inlineField], inlineField);
  const path = hasPath ? input[pathField] : defaultPath;
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError(`${inlineField} or ${pathField} is required`);
  }
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = parseInput(Buffer.concat(chunks).toString('utf8'));
  if (input.version !== REQUEST_VERSION) throw new TypeError('century compile request version is unsupported');
  if (!Object.hasOwn(input, 'centuryPlan')) throw new TypeError('centuryPlan is required');

  const natalFixedBundle = assertNatalFixedBundleV1(await readJsonChoice(
    input,
    'natalFixedBundle',
    'natalFixedBundlePath',
  ));
  const releaseSource = await readJsonChoice(
    input,
    'releaseManifest',
    'releaseManifestPath',
    'release-manifest.json',
  );
  const releaseContext = admitReleaseManifestV2(JSON.stringify(releaseSource));
  if (natalFixedBundle.release.releaseManifestHash !== releaseContext.releaseManifestHash) {
    throw new TypeError('natalFixedBundle and releaseManifest do not share release identity');
  }
  const plan = captureJsonData(input.centuryPlan, 'centuryPlan');
  if (plan.subjectRef !== natalFixedBundle.subjectContext.subjectRef) {
    throw new TypeError('centuryPlan.subjectRef must equal NatalFixedBundleV1 subjectRef');
  }
  if (plan.snapshotRef === 'natal-fixed-bundle:self') plan.snapshotRef = natalFixedBundle.bundleHash;
  if (plan.snapshotRef !== natalFixedBundle.bundleHash) {
    throw new TypeError('centuryPlan.snapshotRef must equal NatalFixedBundleV1.bundleHash');
  }

  const generation = await buildCenturyTemporalCandidatesV1(
    plan,
    REFERENCE_CALENDAR_PROVIDER,
  );
  const candidateSet = buildTemporalLayerCandidateSetV1({
    version: TEMPORAL_LAYER_CANDIDATE_SET_VERSION,
    subjectRef: generation.subjectRef,
    candidates: generation.candidates,
    provenanceRefs: [
      `century-generation:${generation.generationHash}`,
      `century-plan:${generation.planHash}`,
    ],
  });
  const request = buildTemporalKernelRequestV1({
    version: TEMPORAL_KERNEL_REQUEST_VERSION,
    requestSchemaVersion: TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION,
    natalFixedBundleHash: natalFixedBundle.bundleHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    activeProfileId: natalFixedBundle.release.profileId,
    subjectRef: generation.subjectRef,
    targetRangeRef: 'age-range:elapsed-anniversary:0-100-inclusive',
    provenanceRefs: [
      `century-generation:${generation.generationHash}`,
      `natal-fixed-bundle:${natalFixedBundle.bundleHash}`,
    ],
    metadata: {
      ageFrom: generation.ageFrom,
      ageThrough: generation.ageThrough,
      samplingProfileId: generation.plan.anniversaryProfileId,
    },
  });
  const temporalKernelBatch = compileTemporalRequest(
    request,
    candidateSet,
    natalFixedBundle,
    releaseContext,
  );
  const ageIndex = generation.ageResults.map((generationResult) => {
    if (generationResult.status !== 'generated') {
      return deepFreeze({
        version: 'yuracore.century_age_index.v1',
        age: generationResult.age,
        localAt: generationResult.localAt,
        generationStatus: generationResult.status,
        generationResultHash: generationResult.resultHash,
        temporalCompilationStatus: 'not_run',
        temporalResultHash: null,
      });
    }
    const temporal = temporalKernelBatch.results[generationResult.candidateOrdinal];
    return deepFreeze({
      version: 'yuracore.century_age_index.v1',
      age: generationResult.age,
      localAt: generationResult.localAt,
      generationStatus: generationResult.status,
      generationResultHash: generationResult.resultHash,
      temporalCandidateId: generationResult.temporalCandidateId,
      temporalCompilationStatus: temporal.status,
      temporalResultHash: temporal.resultHash,
    });
  });
  const lifeStageTimeline = buildLifeStageTimeline();
  const generationSummary = deepFreeze({
    version: generation.version,
    planHash: generation.planHash,
    generationHash: generation.generationHash,
    inputAgeCount: generation.inputAgeCount,
    ageResultCount: generation.ageResultCount,
    generatedCount: generation.generatedCount,
    failedCount: generation.failedCount,
    ageResults: generation.ageResults,
  });
  const identity = deepFreeze({
    version: BUNDLE_VERSION,
    subjectRef: generation.subjectRef,
    natalFixedBundleHash: natalFixedBundle.bundleHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    centuryPlanHash: generation.planHash,
    centuryGenerationHash: generation.generationHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    temporalKernelBatchHash: temporalKernelBatch.temporalKernelBatchHash,
    lifeStageTimelineHash: lifeStageTimeline.timelineHash,
    ageFrom: generation.ageFrom,
    ageThrough: generation.ageThrough,
    ageCount: ageIndex.length,
    generatedCandidateCount: generation.generatedCount,
    generationFailureCount: generation.failedCount,
    temporalCompiledCount: temporalKernelBatch.counts.compiled,
    temporalFailureCount: temporalKernelBatch.resultCount - temporalKernelBatch.counts.compiled,
    ageIndexHashes: ageIndex.map((row) => domainHashV1('yuracore.century_age_index.v1', row)),
    judgmentStatus: 'not_evaluated',
    causalStatus: 'not_modeled',
    effectEligible: false,
  });
  const output = deepFreeze({
    ...identity,
    centuryPlan: generation.plan,
    generation: generationSummary,
    temporalLayerCandidateSet: candidateSet,
    temporalKernelBatch,
    lifeStageTimeline,
    ageIndex,
    centuryTemporalBundleHash: domainHashV1('yuracore.century_temporal_bundle.v1', identity),
  });
  process.stdout.write(`${canonicalJsonV1(output)}\n`);
}

main().catch((error) => {
  const body = {
    version: ERROR_VERSION,
    stableErrorCode: error instanceof TypeError || error instanceof RangeError
      ? 'yuracore.century_temporal_error.invalid_input'
      : 'yuracore.century_temporal_error.internal_error',
    retryable: !(error instanceof TypeError || error instanceof RangeError),
  };
  process.stderr.write(`${canonicalJsonV1({
    ...body,
    errorHash: domainHashV1('yuracore.century_temporal_error.v1', body),
    diagnostics: { errorName: error?.name ?? 'Error', message: error?.message ?? String(error) },
  })}\n`);
  process.exitCode = 1;
});
