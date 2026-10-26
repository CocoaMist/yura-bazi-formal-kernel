import {
  BAZI_STRUCTURAL_CODEBOOK,
  BAZI_STRUCTURAL_PROFILE,
  GROWTH_STAGE_PROFILE,
  HIDDEN_STEM_PROFILE,
  SEXAGENARY_XUN_VOID_PROFILE,
} from '../bazi/foundation-profile.mjs';
import { BAZI_RELATION_CODEBOOK, BAZI_RELATION_PROFILE } from '../bazi/relation-profile.mjs';
import { CANONICAL_ENCODING_PROFILE, HASHING_PROFILE } from '../shared/identity-profiles.mjs';
import { deepFreeze } from '../shared/assert.mjs';
import { contentHashV1, domainHashV1, parseCanonicalJsonV1 } from '../shared/canonical.mjs';

export const RELEASE_MANIFEST_VERSION = 'formal.release_manifest.v2';
export const RELEASE_MANIFEST_SCHEMA_VERSION = 'formal.release_manifest.schema.v2';
export const RELEASE_CANDIDATE_MANIFEST_VERSION = 'formal.release_candidate_manifest.v1';
export const RELEASE_ADMISSION_RECORD_VERSION = 'formal.release_admission_record.v1';
export const DETERMINISTIC_TABLE_MANIFEST_VERSION = 'bazi.deterministic_table_manifest.v1';
export const RESOLVED_RELEASE_CONTEXT_VERSION = 'bazi.resolved_release_context.v1';
export const RELEASE_COMPILATION_CONTEXT_VERSION = RESOLVED_RELEASE_CONTEXT_VERSION;
export const SELECTED_RELATION_PROFILE_VERSION = 'bazi.selected_relation_profile.v1';

const resolvedContexts = new WeakSet();
const selectedProfiles = new WeakSet();
const tableRegistry = new Map([
  ['bazi.structural_codebook.v1', BAZI_STRUCTURAL_CODEBOOK],
  ['bazi.structural_foundation_profile.v1', BAZI_STRUCTURAL_PROFILE],
  ['bazi.hidden_stems.modern_common_order.v1', HIDDEN_STEM_PROFILE],
  ['bazi.growth_stage.ten_stem_yang_forward_yin_reverse_fire_earth.v1', GROWTH_STAGE_PROFILE],
  [SEXAGENARY_XUN_VOID_PROFILE.id, SEXAGENARY_XUN_VOID_PROFILE],
  [BAZI_RELATION_CODEBOOK.version, BAZI_RELATION_CODEBOOK],
]);
const relationProfileRegistry = new Map([[BAZI_RELATION_PROFILE.id, BAZI_RELATION_PROFILE]]);
const STRUCTURAL_CANDIDATE_ENUMERATOR = deepFreeze({
  enumeratorId: 'bazi.structural_candidate_enumerator',
  enumeratorVersion: 'bazi.structural_candidate_enumerator.v2',
  semantics: 'occurrence_cartesian_profile_scoped_candidates_only',
});

function requireHash(value, field) {
  if (!/^sha256:[0-9a-f]{64}$/.test(value ?? '')) {
    throw new TypeError(`${field} must be a full sha256 content hash`);
  }
  return value;
}

function withoutField(value, field) {
  const result = structuredClone(value);
  delete result[field];
  return result;
}

function releaseCandidatePreimage(manifest) {
  return Object.fromEntries(Object.entries(manifest).filter(([key]) => ![
    'releaseCandidate', 'auditReports', 'releaseAdmissionRecord', 'semanticIdentity',
  ].includes(key)));
}

function containsKey(value, forbiddenKey) {
  if (value == null || typeof value !== 'object') return false;
  if (Object.hasOwn(value, forbiddenKey)) return true;
  return Object.values(value).some((child) => containsKey(child, forbiddenKey));
}

function validateReleaseIdentity(manifest) {
  if (manifest.version !== RELEASE_MANIFEST_VERSION
    || manifest.manifestSchemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError('ReleaseManifest version or schema version is unsupported');
  }
  if (manifest.releaseCandidate?.version !== RELEASE_CANDIDATE_MANIFEST_VERSION) {
    throw new TypeError('ReleaseManifest requires ReleaseCandidateManifestV1 identity');
  }
  const candidateManifestHash = requireHash(
    manifest.releaseCandidate.candidateManifestHash,
    'ReleaseCandidateManifest.candidateManifestHash',
  );
  if (contentHashV1(releaseCandidatePreimage(manifest)) !== candidateManifestHash) {
    throw new TypeError('candidateManifestHash does not match the pre-audit release candidate');
  }
  if (!Array.isArray(manifest.auditReports) || manifest.auditReports.length === 0) {
    throw new TypeError('ReleaseManifest requires audit reports');
  }
  if (containsKey(manifest.auditReports, 'releaseManifestHash')) {
    throw new TypeError('AuditReport preimage must not contain final releaseManifestHash');
  }
  const auditReportHashes = manifest.auditReports.map((report, index) => {
    if (report.candidateManifestHash !== candidateManifestHash) {
      throw new TypeError(`AuditReport[${index}] does not bind candidateManifestHash`);
    }
    return contentHashV1(report);
  });
  const admission = manifest.releaseAdmissionRecord;
  if (admission?.version !== RELEASE_ADMISSION_RECORD_VERSION
    || admission.status !== 'admitted'
    || admission.candidateManifestHash !== candidateManifestHash
    || JSON.stringify(admission.auditReportHashes) !== JSON.stringify(auditReportHashes)) {
    throw new TypeError('ReleaseAdmissionRecord does not bind the candidate and ordered audit reports');
  }
  const releaseManifestHash = requireHash(
    manifest.semanticIdentity?.releaseManifestHash,
    'ReleaseManifest.semanticIdentity.releaseManifestHash',
  );
  const preimage = structuredClone(manifest);
  delete preimage.semanticIdentity.releaseManifestHash;
  if (contentHashV1(preimage) !== releaseManifestHash) {
    throw new TypeError('ReleaseManifest releaseManifestHash does not match its complete preimage');
  }
  return { candidateManifestHash, auditReportHashes, releaseManifestHash };
}

function validateTableManifest(tableManifest) {
  if (tableManifest?.version !== DETERMINISTIC_TABLE_MANIFEST_VERSION
    || typeof tableManifest.schemaVersion !== 'string'
    || !Array.isArray(tableManifest.tables)) {
    throw new TypeError('ReleaseManifest requires a versioned deterministicTableManifest');
  }
  const manifestHash = requireHash(
    tableManifest.deterministicTableManifestHash,
    'DeterministicTableManifest.deterministicTableManifestHash',
  );
  if (contentHashV1(withoutField(tableManifest, 'deterministicTableManifestHash')) !== manifestHash) {
    throw new TypeError('DeterministicTableManifest hash does not match its preimage');
  }
  const seen = new Set();
  for (const entry of tableManifest.tables) {
    if (seen.has(entry.tableId)) throw new TypeError(`duplicate deterministic table: ${entry.tableId}`);
    seen.add(entry.tableId);
    const registered = tableRegistry.get(entry.tableId);
    if (!registered) throw new TypeError(`unregistered deterministic table: ${entry.tableId}`);
    if (contentHashV1(registered) !== requireHash(entry.contentHash, `table ${entry.tableId}`)) {
      throw new TypeError(`deterministic table content hash mismatch: ${entry.tableId}`);
    }
  }
  for (const tableId of tableRegistry.keys()) {
    if (!seen.has(tableId)) throw new TypeError(`required deterministic table missing: ${tableId}`);
  }
  return manifestHash;
}

function validateRelationProfileRegistry(section) {
  if (typeof section?.schemaVersion !== 'string' || !Array.isArray(section.entries)) {
    throw new TypeError('ReleaseManifest requires a versioned relationProfiles registry');
  }
  if (Object.hasOwn(section, 'activeProfileId')) {
    throw new TypeError('RelationProfile registry must not select activeProfileId');
  }
  const ids = new Set();
  for (const entry of section.entries) {
    if (ids.has(entry.profileId)) throw new TypeError(`duplicate RelationProfile: ${entry.profileId}`);
    ids.add(entry.profileId);
    if (typeof entry.profileSchemaVersion !== 'string') {
      throw new TypeError(`RelationProfile is unversioned: ${entry.profileId}`);
    }
    const profile = relationProfileRegistry.get(entry.profileId);
    if (!profile) throw new TypeError(`unregistered RelationProfile: ${entry.profileId}`);
    if (contentHashV1(profile) !== requireHash(entry.contentHash, 'RelationProfile.contentHash')) {
      throw new TypeError(`RelationProfile content hash mismatch: ${entry.profileId}`);
    }
  }
  return domainHashV1('bazi.relation_profile_registry.v1', section);
}

function validateProfiles(manifest) {
  const encoding = manifest.canonicalEncodingProfile;
  const hashing = manifest.hashingProfile;
  if (hashing?.canonicalEncodingProfileHash !== encoding?.profileHash) {
    throw new TypeError('HashingProfile does not bind CanonicalEncodingProfile');
  }
  if (encoding?.profileHash !== CANONICAL_ENCODING_PROFILE.profileHash
    || contentHashV1(withoutField(encoding, 'profileHash')) !== encoding.profileHash) {
    throw new TypeError('CanonicalEncodingProfile does not match the admitted implementation');
  }
  if (hashing?.profileHash !== HASHING_PROFILE.profileHash
    || contentHashV1(withoutField(hashing, 'profileHash')) !== hashing.profileHash) {
    throw new TypeError('HashingProfile does not match the admitted implementation');
  }
  if (contentHashV1(manifest.structuralCandidateEnumerator)
    !== contentHashV1(STRUCTURAL_CANDIDATE_ENUMERATOR)) {
    throw new TypeError('StructuralCandidateEnumerator identity is unsupported');
  }
}

export function admitReleaseManifestV2(source) {
  const manifest = parseCanonicalJsonV1(source, 'ReleaseManifestV2');
  const identity = validateReleaseIdentity(manifest);
  const tableManifestHash = validateTableManifest(manifest.deterministicTableManifest);
  const relationProfileRegistryHash = validateRelationProfileRegistry(manifest.relationProfiles);
  validateProfiles(manifest);
  const frozenManifest = deepFreeze(manifest);
  const componentHashes = deepFreeze({
    engineHash: domainHashV1('formal.release.engine.v1', manifest.engine),
    schemasHash: domainHashV1('formal.release.schemas.v1', [...manifest.schemas].sort()),
    deterministicTableManifestHash: tableManifestHash,
    relationProfileRegistryHash,
    structuralCandidateEnumeratorHash: contentHashV1(manifest.structuralCandidateEnumerator),
    canonicalEncodingProfileHash: manifest.canonicalEncodingProfile.profileHash,
    hashingProfileHash: manifest.hashingProfile.profileHash,
  });
  const context = deepFreeze({
    version: RESOLVED_RELEASE_CONTEXT_VERSION,
    manifest: frozenManifest,
    releaseManifestHash: identity.releaseManifestHash,
    candidateManifestHash: identity.candidateManifestHash,
    engine: frozenManifest.engine,
    schemas: frozenManifest.schemas,
    deterministicTableContext: frozenManifest.deterministicTableManifest,
    relationProfileRegistry: frozenManifest.relationProfiles,
    relationProfileRegistryHash,
    structuralCandidateEnumerator: frozenManifest.structuralCandidateEnumerator,
    canonicalEncodingProfile: frozenManifest.canonicalEncodingProfile,
    hashingProfile: frozenManifest.hashingProfile,
    componentHashes,
    auditReportRefs: frozenManifest.auditReports,
  });
  resolvedContexts.add(context);
  return context;
}

// Explicit compatibility name; it admits only the v2 manifest and creates no
// legacy runtime configuration path.
export const admitReleaseManifestV1 = admitReleaseManifestV2;

export function assertResolvedReleaseContext(value, field = 'ResolvedReleaseContextV1') {
  if (!value || typeof value !== 'object' || !resolvedContexts.has(value)) {
    throw new TypeError(`${field} must be produced by admitReleaseManifestV2`);
  }
  return value;
}

export const assertReleaseCompilationContext = assertResolvedReleaseContext;

export function resolveSelectedRelationProfile(releaseContextValue, activeProfileId) {
  const context = assertResolvedReleaseContext(releaseContextValue);
  if (typeof activeProfileId !== 'string' || activeProfileId.length === 0) {
    throw new TypeError('activeProfileId must be a non-empty string from NatalCompilationRequestV1');
  }
  const profileRef = context.relationProfileRegistry.entries.find(
    (entry) => entry.profileId === activeProfileId,
  );
  if (!profileRef) throw new RangeError(`activeProfileId is not admitted: ${activeProfileId}`);
  const profile = relationProfileRegistry.get(profileRef.profileId);
  const body = {
    version: SELECTED_RELATION_PROFILE_VERSION,
    profileId: profileRef.profileId,
    profileSchemaVersion: profileRef.profileSchemaVersion,
    profileContentHash: profileRef.contentHash,
    registryHash: context.relationProfileRegistryHash,
    releaseManifestHash: context.releaseManifestHash,
  };
  const selected = deepFreeze({
    ...body,
    selectedRelationProfileHash: domainHashV1('bazi.selected_relation_profile.v1', body),
    profile,
  });
  selectedProfiles.add(selected);
  return selected;
}

export function assertSelectedRelationProfile(value, field = 'SelectedRelationProfileV1') {
  if (!value || typeof value !== 'object' || !selectedProfiles.has(value)) {
    throw new TypeError(`${field} must be produced by resolveSelectedRelationProfile`);
  }
  return value;
}
