import { BAZI_STRUCTURAL_CODEBOOK } from './foundation-profile.mjs';
import { deriveBaziStructuralCodesFromCoordinate } from './structure.mjs';
import { BAZI_RELATION_CODEBOOK } from './relation-profile.mjs';
import { deriveBaziRelationMaterialsFromCoordinate } from './relations.mjs';
import { contentHashV1, domainHashV1 } from '../shared/canonical.mjs';
import { TYPED_FACT_VERSION } from '../algebra/typed-fact.mjs';
import {
  assertResolvedReleaseContext,
  assertSelectedRelationProfile,
} from '../release/manifest.mjs';

// The registry values remain immutable local implementations, but compilation
// identity is selected by an admitted external ReleaseManifest. A coordinate
// never selects or fabricates its table/profile configuration.
const RELATION_CODEBOOK_HASH = contentHashV1(BAZI_RELATION_CODEBOOK);
export const BAZI_FACT_COMPILER_SEMANTICS_VERSION = 'bazi.fact_compiler_semantics.v4';
export const BAZI_FACT_COMPILER_SEMANTICS_HASH = domainHashV1(
  'bazi.fact_compiler_semantics.v1',
  { version: BAZI_FACT_COMPILER_SEMANTICS_VERSION },
);

function withMaterialIdentity(materials, contentHash, snapshotHash) {
  return Object.freeze({
    ...materials,
    contentHash,
    materialHash: snapshotHash == null
      ? null
      : contentHashV1({ snapshotHash, contentHash }),
  });
}

export function assertDeterministicTableContext(tableManifest) {
  if (tableManifest?.version !== 'bazi.deterministic_table_manifest.v1'
    || typeof tableManifest.schemaVersion !== 'string'
    || typeof tableManifest.deterministicTableManifestHash !== 'string') {
    throw new TypeError('compileStructuralMaterials requires an admitted DeterministicTableManifest');
  }
  return tableManifest;
}

export function compileStructuralMaterials(coordinate, releaseContextValue, snapshotHash = null) {
  const releaseContext = assertResolvedReleaseContext(releaseContextValue);
  const deterministicTableManifest = assertDeterministicTableContext(
    releaseContext.deterministicTableContext,
  );
  const materials = deriveBaziStructuralCodesFromCoordinate(coordinate);
  const foundationDependencyHash = domainHashV1('bazi.foundation_dependency.v1', {
    coordinateHash: coordinate.coordinateHash,
    factCompilerSemanticsHash: BAZI_FACT_COMPILER_SEMANTICS_HASH,
    usedTableManifestHash: deterministicTableManifest.deterministicTableManifestHash,
    usedTableManifestSchemaVersion: deterministicTableManifest.schemaVersion,
    typedFactSchemaVersion: TYPED_FACT_VERSION,
    canonicalEncodingProfileHash: releaseContext.componentHashes.canonicalEncodingProfileHash,
    hashingProfileHash: releaseContext.componentHashes.hashingProfileHash,
  });
  const contentHash = domainHashV1('bazi.structural_materials.v4', materials);
  return withMaterialIdentity({
    ...materials,
    coordinateHash: coordinate.coordinateHash,
    foundationDependencyHash,
    factCompilerSemanticsHash: BAZI_FACT_COMPILER_SEMANTICS_HASH,
    deterministicTableManifestRef: Object.freeze({
      version: deterministicTableManifest.version,
      schemaVersion: deterministicTableManifest.schemaVersion,
      deterministicTableManifestHash: deterministicTableManifest.deterministicTableManifestHash,
    }),
  }, contentHash, snapshotHash);
}

export function compileRelationMaterials(coordinate, selectedProfileValue, snapshotHash = null) {
  const selectedProfile = assertSelectedRelationProfile(selectedProfileValue);
  const relationProfile = selectedProfile.profile;
  const materials = deriveBaziRelationMaterialsFromCoordinate(coordinate, relationProfile);
  const contentHash = domainHashV1('bazi.relation_materials.v3', {
    coordinateHash: coordinate.coordinateHash,
    relationCodebookHash: RELATION_CODEBOOK_HASH,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    materials,
  });
  return withMaterialIdentity({
    ...materials,
    selectedRelationProfileHash: selectedProfile.selectedRelationProfileHash,
    relationProfileRef: {
      profileId: selectedProfile.profileId,
      profileSchemaVersion: selectedProfile.profileSchemaVersion,
      contentHash: selectedProfile.profileContentHash,
    },
  }, contentHash, snapshotHash);
}
