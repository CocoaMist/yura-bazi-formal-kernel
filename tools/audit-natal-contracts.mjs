import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHashV1 } from '../src/shared/canonical.mjs';
import { CANDIDATE_COMPILATION_STATUSES } from '../src/bazi/kernel.mjs';
import { BAZI_RELATION_PROFILE } from '../src/bazi/relation-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
const core = await readFile(join(root, 'CORE.md'), 'utf8');
const kernel = await readFile(join(root, 'src/bazi/kernel.mjs'), 'utf8');
const contracts = await readFile(join(root, 'src/bazi/compilation-contracts.mjs'), 'utf8');
const candidates = await readFile(join(root, 'src/bazi/candidates.mjs'), 'utf8');
const birthCompiler = await readFile(join(root, 'tools/compile-birth.mjs'), 'utf8');
const fixedBundleSource = await readFile(join(root, 'src/bazi/natal-fixed-bundle.mjs'), 'utf8');
const temporalIndexSource = await readFile(join(root, 'src/bazi/temporal-match-index.mjs'), 'utf8');
const temporalCoreSource = await readFile(join(root, 'src/bazi/temporal-core.mjs'), 'utf8');
const centuryCompilerSource = await readFile(join(root, 'tools/compile-century.mjs'), 'utf8');
const rawRelationSource = await readFile(join(root, 'src/bazi/raw-relation-matches.mjs'), 'utf8');
const sampleOutput = JSON.parse(await readFile(
  join(root, 'examples/2000-07-19-beijing-male.output.json'),
  'utf8',
));
const schemaDirectory = join(root, 'schemas');
const schemaFiles = (await readdir(schemaDirectory)).filter((name) => name.endsWith('.json'));
const schemaDocuments = new Map();
for (const name of schemaFiles) {
  schemaDocuments.set(name, JSON.parse(await readFile(join(schemaDirectory, name), 'utf8')));
}

function visitRefs(value, file) {
  if (value == null || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) {
    const target = value.$ref.split('#')[0];
    if (!schemaDocuments.has(target)) throw new Error(`unresolved schema ref in ${file}: ${value.$ref}`);
  }
  for (const child of Object.values(value)) visitRefs(child, file);
}
for (const [name, document] of schemaDocuments) visitRefs(document, name);

if (Object.hasOwn(manifest.relationProfiles, 'activeProfileId')) {
  throw new Error('release registry must not select activeProfileId');
}
for (const field of [
  'canonicalEncodingProfile', 'hashingProfile', 'structuralCandidateEnumerator',
]) {
  if (manifest[field] == null) throw new Error(`release manifest missing ${field}`);
}
for (const status of ['compiled', 'validation_failed', 'compilation_failed', 'internal_error']) {
  if (!CANDIDATE_COMPILATION_STATUSES.includes(status)) throw new Error(`unhandled result status: ${status}`);
}
for (const field of [
  'coordinateHash', 'foundationDependencyHash', 'semanticHash', 'derivationHash',
  'contentHash', 'canonicalFactGraphHash', 'structuralCandidateSetHash',
  'compiledNatalArtifactHash', 'natalCompilationBatchHash',
]) {
  if (!core.includes(`\`${field}\``)) throw new Error(`CORE.md lacks hash definition: ${field}`);
}
for (const token of [
  'inputCount !== batchIdentity.resultCount',
  'resolveSelectedRelationProfile',
  'candidateSnapshotSetHash',
  'calendarDecisionTraceHash',
]) {
  if (!(kernel.includes(token) || contracts.includes(token))) throw new Error(`runtime invariant missing: ${token}`);
}
for (const token of [
  'relationRuleId', 'directionality', 'orderedRoleBindings',
  'missingMemberRequirements', 'selectedRelationProfileHash',
]) {
  if (!candidates.includes(token)) throw new Error(`candidate contract missing: ${token}`);
}
if (BAZI_RELATION_PROFILE.scope.selfPunishment.allowSelfLoop !== false
  || BAZI_RELATION_PROFILE.scope.selfPunishment.minimumDistinctOccurrences !== 2) {
  throw new Error('RelationProfile self-punishment cardinality is incomplete');
}
for (const node of [
  'BirthCompilationInputV1', 'BirthCompilationBundleV1',
  'NatalFixedBundleV1', 'NatalFixedStateV1', 'TemporalMatchIndexV1',
  'RawStructuralMatchSetV1', 'ProfileScopedRawRelationMatchesV1',
  'CalendarResolutionEnvelopeV1', 'NatalCompilationRequestV1',
  'ResolvedReleaseContextV1', 'CandidateSnapshotSetV2',
  'CanonicalFactGraphV4', 'TypedFactClosureV2',
  'TemporalLayerCandidateSetV1', 'TemporalKernelBatchV1',
]) {
  if (!core.includes(node)) throw new Error(`architecture node missing from CORE.md: ${node}`);
}
if (sampleOutput.version !== 'bazi.natal_fixed_bundle.v1'
  || sampleOutput.pathCount !== 2
  || sampleOutput.distinctFixedStateCount !== 1
  || Object.keys(sampleOutput.fixedStatesByHash).length !== 1) {
  throw new Error('birth regression fixture does not preserve two paths and one fixed state');
}
const forbiddenFixedFields = [
  'activationStatus', 'transformationStatus', 'effectEligible',
  'favorabilityInferred', 'strengthInferred', 'precedenceInferred',
  'productAuthority', 'score', 'claim', 'judgment', 'naturalLanguageSummary',
];
function findForbiddenKey(value) {
  if (value == null || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFixedFields.includes(key)) return key;
    const nested = findForbiddenKey(child);
    if (nested) return nested;
  }
  return null;
}
const forbiddenKey = findForbiddenKey(sampleOutput);
if (forbiddenKey) throw new Error(`fixed regression fixture contains forbidden field: ${forbiddenKey}`);

const findings = {
  schemaFileCount: schemaFiles.length,
  schemaRefsResolvable: true,
  manifestAuthorityClosed: true,
  resultStatusesHandled: [...CANDIDATE_COMPILATION_STATUSES],
  totalMapInvariantPresent: true,
  relationProfileRuleCount:
    BAZI_RELATION_PROFILE.stemCombinationPairs.length
    + Object.values(BAZI_RELATION_PROFILE.branchPairCandidates).flat().length
    + BAZI_RELATION_PROFILE.completeHyperedgeGroups.length,
  relationDirectionalityAndArityDeclared: true,
  identityReferencesClosed: true,
  architectureImplementationMappingPresent: true,
  birthJsonBoundaryClosed:
    birthCompiler.includes("LEGACY_BUNDLE_VERSION = 'yuracore.birth_compilation_bundle.v1'")
    && birthCompiler.includes('buildNatalCalendarArtifacts')
    && birthCompiler.includes('compileNatalRequest')
    && birthCompiler.includes('buildNatalFixedBundleV1')
    && birthCompiler.includes("argument !== '--legacy-bundle-v1'"),
  fixedBundleDefaultAndLegacyExplicit: true,
  fixedStateDeduplicationAndPathLineage:
    fixedBundleSource.includes('fixedStateMap')
    && fixedBundleSource.includes('source_projection')
    && fixedBundleSource.includes('fixedStatesByHash'),
  temporalIndexCoverageDeclared:
    temporalIndexSource.includes('STEM_IDS.map')
    && temporalIndexSource.includes('BRANCH_IDS.map')
    && temporalIndexSource.includes('SEXAGENARY_PILLARS.map'),
  temporalCoreTotalMapAndReleaseBinding:
    temporalCoreSource.includes('TEMPORAL_LAYER_CANDIDATE_SET_VERSION')
    && temporalCoreSource.includes('resolveSelectedRelationProfile')
    && temporalCoreSource.includes('inputCount: candidateSet.candidateCount')
    && temporalCoreSource.includes('resultCount: results.length'),
  temporalSixLayerPairCardinality:
    temporalCoreSource.includes("'major_luck', 'minor_luck', 'year', 'month', 'day', 'hour'")
    && temporalCoreSource.includes('pillarPairCount: pairs.length')
    && temporalCoreSource.includes('natalTemporalPillarPairSlotCount: TEMPORAL_LAYER_IDS.length * 4'),
  centuryJsonBoundaryClosed:
    centuryCompilerSource.includes("BUNDLE_VERSION = 'yuracore.century_temporal_bundle.v1'")
    && centuryCompilerSource.includes('buildCenturyTemporalCandidatesV1')
    && centuryCompilerSource.includes('compileTemporalRequest'),
  fixedLayerForbiddenFieldsGuarded:
    rawRelationSource.includes('FIXED_LAYER_FORBIDDEN_FIELDS')
    && rawRelationSource.includes('assertNoForbiddenFixedFields'),
  regressionFixturePathCount: sampleOutput.pathCount,
  regressionFixtureDistinctFixedStateCount: sampleOutput.distinctFixedStateCount,
};
if (!findings.birthJsonBoundaryClosed) throw new Error('birth JSON adapter does not traverse calendar artifacts and the admitted compiler');
if (!findings.temporalCoreTotalMapAndReleaseBinding
  || !findings.temporalSixLayerPairCardinality
  || !findings.centuryJsonBoundaryClosed) {
  throw new Error('temporal runtime or century JSON boundary is incomplete');
}
console.log(JSON.stringify({
  report: 'natal_structural_contract_audit',
  candidateManifestHash: manifest.releaseCandidate.candidateManifestHash,
  findings,
  auditDigest: contentHashV1(findings),
}, null, 2));
