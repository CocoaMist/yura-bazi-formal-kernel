import { deepFreeze } from './assert.mjs';
import { contentHashV1 } from './canonical.mjs';

export const CANONICAL_ENCODING_PROFILE_VERSION = 'formal.canonical_encoding_profile.v1';
export const HASHING_PROFILE_VERSION = 'formal.hashing_profile.v1';

function withProfileHash(body) {
  return deepFreeze({ ...body, profileHash: contentHashV1(body) });
}

export const CANONICAL_ENCODING_PROFILE = withProfileHash({
  version: CANONICAL_ENCODING_PROFILE_VERSION,
profileId: 'formal.canonical_json.nfc_code_unit.v2',
  objectKeys: 'sorted_by_utf16_code_unit',
  arrays: 'ordered',
  sets: 'schema_declared_then_sorted_by_canonical_identity',
  nullSemantics: 'distinct_from_missing',
  missingFields: 'forbidden_by_exact_record_contracts',
  unicodeNormalization: 'NFC',
  stringEncoding: 'UTF-8',
  enumCase: 'exact_case_sensitive',
  numbers: 'finite_json_number_negative_zero_canonicalized_to_zero',
  floatsAllowed: true,
  dateTime: 'schema_declared_rfc3339_or_opaque_reference',
  selfHashFields: 'excluded_by_each_named_hash_preimage',
  nonDeterministicDiagnostics: 'excluded_from_semantic_identity',
  provenanceIdentity: 'only_explicit_identityProvenanceRefs',
});

export const HASHING_PROFILE = withProfileHash({
  version: HASHING_PROFILE_VERSION,
profileId: 'formal.sha256.domain_separated.v2',
  algorithm: 'sha256',
  domainPrefix: 'yura.formal.hash.v1\\0',
  canonicalEncodingProfileHash: CANONICAL_ENCODING_PROFILE.profileHash,
});
