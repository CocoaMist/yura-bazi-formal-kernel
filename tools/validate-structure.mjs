import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHashV1 } from '../src/shared/canonical.mjs';
import { validateProjectPaths } from './validate-project-paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'AGENTS.md', 'CORE.md', 'TIME_CORE.md', 'README.md', 'package.json', 'release-manifest.json',
  'src/index.mjs', 'src/bazi/encoding.mjs', 'src/state/resolver.mjs',
  'src/bazi/foundation-profile.mjs', 'src/bazi/structure.mjs',
  'src/bazi/relation-profile.mjs', 'src/bazi/relations.mjs',
  'src/bazi/materials.mjs', 'src/bazi/fact-graph.mjs',
  'src/bazi/raw-relation-matches.mjs', 'src/bazi/temporal-match-index.mjs',
  'src/bazi/natal-fixed-bundle.mjs', 'src/bazi/temporal-core.mjs',
  'src/bazi/compilation-contracts.mjs', 'src/bazi/kernel.mjs',
  'src/algebra/evaluation-context.mjs',
  'src/algebra/fact-closure.mjs', 'src/shared/identity-profiles.mjs',
  'src/causal/contribution.mjs', 'src/systems/boundary.mjs',
  'schemas/catalog.json', 'schemas/natal-compilation.schema.json',
  'schemas/birth-compilation.schema.json', 'schemas/natal-fixed.schema.json',
  'schemas/release-profiles.schema.json', 'schemas/temporal-core.schema.json',
  'schemas/typed-fact-closure.schema.json',
  'tools/audit-relation-space.mjs', 'tools/audit-natal-contracts.mjs',
  'tools/compile-natal.mjs',
  'tools/compile-birth.mjs', 'tools/compile-century.mjs',
  'tools/compile-six-layer-instant.mjs',
  'examples/2000-07-19-beijing-male.input.json',
  'examples/2000-07-19-beijing-male.output.json',
  'docs/MIGRATION-NATAL-FIXED-V1.md',
  'tests',
];

for (const path of required) await lstat(join(root, path));

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
const timeCore = await readFile(join(root, 'TIME_CORE.md'), 'utf8');

for (const required of [
  'TemporalLayerCandidateSetV1',
  'TemporalKernelBatchV1',
  'total-map compileTemporalCandidate',
  'inputCount == resultCount == N',
  '`major_luck`', '`minor_luck`', '`year`', '`month`', '`day`', '`hour`',
  '`judgmentStatus: "not_evaluated"`',
  '`causalStatus: "not_modeled"`',
  '`effectEligible: false`',
  '时间关系本身永远不能直接产生 Effect',
]) {
  if (!timeCore.includes(required)) throw new Error(`TIME_CORE.md is missing contract invariant: ${required}`);
}
const timeCoreMermaid = [...timeCore.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)];
if (timeCoreMermaid.length !== 1
  || !/EvaluationContext[\s\S]*the same RuleExecutionPlan/.test(timeCoreMermaid[0][1])) {
  throw new Error('TIME_CORE.md must keep one rule-chain reuse diagram');
}

// The ReleaseManifest, not this script, pins what a release freezes. Counts
// live under releaseReport as a snapshot and must never become a gate.
if (manifest.version !== 'formal.release_manifest.v2') {
  throw new Error('release manifest version must be formal.release_manifest.v2');
}
for (const section of [
  'manifestSchemaVersion', 'engine', 'schemas', 'deterministicTableManifest',
  'relationProfiles', 'canonicalEncodingProfile', 'hashingProfile',
  'structuralCandidateEnumerator', 'ruleCorpus', 'sourceEditions',
  'sourceInterpretations', 'ruleProfiles', 'resolver', 'releaseCandidate',
  'auditReports', 'releaseAdmissionRecord',
  'qualityGates', 'deferredQualityGates', 'releaseReport',
]) {
  if (manifest[section] == null) throw new Error(`release manifest is missing section: ${section}`);
}
const releaseCandidatePreimage = Object.fromEntries(Object.entries(manifest).filter(([key]) => ![
  'releaseCandidate', 'auditReports', 'releaseAdmissionRecord', 'semanticIdentity',
].includes(key)));
if (manifest.releaseCandidate.version !== 'formal.release_candidate_manifest.v1'
  || manifest.releaseCandidate.candidateManifestHash !== contentHashV1(releaseCandidatePreimage)) {
  throw new Error('candidateManifestHash must cover the complete pre-audit release candidate');
}
function containsKey(value, key) {
  if (value == null || typeof value !== 'object') return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((child) => containsKey(child, key));
}
if (containsKey(manifest.auditReports, 'releaseManifestHash')) {
  throw new Error('audit reports must not contain the final releaseManifestHash');
}
const auditReportHashes = manifest.auditReports.map((report) => contentHashV1(report));
if (manifest.releaseAdmissionRecord.version !== 'formal.release_admission_record.v1'
  || manifest.releaseAdmissionRecord.status !== 'admitted'
  || manifest.releaseAdmissionRecord.candidateManifestHash
    !== manifest.releaseCandidate.candidateManifestHash
  || JSON.stringify(manifest.releaseAdmissionRecord.auditReportHashes)
    !== JSON.stringify(auditReportHashes)) {
  throw new Error('releaseAdmissionRecord must bind the candidate and ordered audit reports');
}
const deterministicTableManifestWithoutSelf = structuredClone(manifest.deterministicTableManifest);
const declaredDeterministicTableManifestHash =
  deterministicTableManifestWithoutSelf.deterministicTableManifestHash;
delete deterministicTableManifestWithoutSelf.deterministicTableManifestHash;
if (declaredDeterministicTableManifestHash !== contentHashV1(deterministicTableManifestWithoutSelf)) {
  throw new Error('deterministicTableManifestHash must cover its complete manifest preimage');
}
if (manifest.engine.version !== pkg.version) {
  throw new Error('release manifest engine version must match package version');
}
if (manifest.engine.publicEntry !== pkg.exports?.['.']) {
  throw new Error('release manifest public entry must match package exports');
}
if (manifest.releaseReport.status !== 'snapshot_of_this_release_only') {
  throw new Error('release report counts must stay marked as a per-release snapshot');
}
const manifestWithoutSelfHash = structuredClone(manifest);
const declaredReleaseManifestHash = manifestWithoutSelfHash.semanticIdentity?.releaseManifestHash;
delete manifestWithoutSelfHash.semanticIdentity.releaseManifestHash;
if (declaredReleaseManifestHash !== contentHashV1(manifestWithoutSelfHash)) {
  throw new Error('releaseManifestHash must cover the complete manifest except its own field');
}
if (manifest.deferredQualityGates.status !== 'contract_only_until_rule_runtime_and_ledgers_exist'
  || !Array.isArray(manifest.deferredQualityGates.requirements)
  || !manifest.deferredQualityGates.requirements.length) {
  throw new Error('deferred quality gates must stay explicit until their runtime exists');
}
if (!manifest.auditReports.length) throw new Error('release manifest requires audit reports');
for (const report of manifest.auditReports) {
  if (report.candidateManifestHash !== manifest.releaseCandidate.candidateManifestHash) {
    throw new Error(`audit report ${report.report} must bind candidateManifestHash`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(report.auditDigest ?? '')) {
    throw new Error(`audit report ${report.report} requires a full sha256 auditDigest`);
  }
  if (report.displayDigest != null && !/^[0-9a-f]{8}$/.test(report.displayDigest)) {
    throw new Error(`audit report ${report.report} displayDigest must be a short hex display value`);
  }
}

if (pkg.private !== true) throw new Error('package must remain private');
if (pkg.type !== 'module') throw new Error('package must use ESM');
if (pkg.engines?.node !== manifest.engine.node) throw new Error('Node engine contract must match the manifest');
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error('runtime dependencies are forbidden');
if (pkg.devDependencies && Object.keys(pkg.devDependencies).length) throw new Error('development dependencies are forbidden');
for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
  if (pkg.scripts?.[hook]) throw new Error(`lifecycle script forbidden: ${hook}`);
}
if (pkg.exports?.['.'] !== './src/index.mjs' || Object.keys(pkg.exports).length !== 1) {
  throw new Error('only src/index.mjs may be public');
}
if (pkg.scripts?.['birth:compile'] !== 'node tools/compile-birth.mjs') {
  throw new Error('birth:compile must expose the JSON boundary adapter');
}
if (pkg.scripts?.['birth:compile:legacy']
  !== 'node tools/compile-birth.mjs --legacy-bundle-v1') {
  throw new Error('birth:compile:legacy must be the explicit compatibility adapter');
}
if (pkg.scripts?.['century:compile'] !== 'node tools/compile-century.mjs') {
  throw new Error('century:compile must expose the 0-100 JSON boundary adapter');
}
if (pkg.scripts?.['sixlayer:compile'] !== 'node tools/compile-six-layer-instant.mjs') {
  throw new Error('sixlayer:compile must expose the named-luck six-layer JSON adapter');
}

await validateProjectPaths(root);

console.log('structure valid');
