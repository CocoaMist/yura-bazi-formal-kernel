import {
  captureExactDataRecord,
  captureJsonData,
  deepFreeze,
  enumValue,
  finiteNumber,
  requiredString,
  stringArray,
} from '../shared/assert.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';

export const TYPED_FACT_VERSION = 'formal.typed_fact.v2';
export const TYPED_FACT_DERIVATION_VERSION = 'formal.typed_fact_derivation.v2';
export const FACT_RECURSION_POLICIES = Object.freeze([
  'forwardable', 'terminal', 'branch_only', 'profile_only',
]);

const typedFacts = new WeakSet();

export function buildTypedFact(input = {}) {
  const source = captureExactDataRecord(input, [
    'factId', 'factType', 'predicate', 'valueSchemaId', 'subjectRefs', 'value',
    'stratum', 'recursionPolicy', 'derivationId', 'configVersion',
    'inputFactRefs', 'natalContentHash', 'snapshotRef', 'provenance',
    'identityProvenanceRefs',
  ], 'TypedFact');
  const subjectRefs = stringArray(source.subjectRefs, 'TypedFact.subjectRefs');
  if (subjectRefs.length === 0) throw new TypeError('TypedFact.subjectRefs must not be empty');
  const stratum = finiteNumber(source.stratum, 'TypedFact.stratum', { min: 0, max: 65_535 });
  if (!Number.isInteger(stratum)) throw new TypeError('TypedFact.stratum must be an integer');
  const value = deepFreeze(captureJsonData(source.value, 'TypedFact.value'));
  const provenance = deepFreeze(captureJsonData(source.provenance, 'TypedFact.provenance'));
  const inputFactRefs = Object.freeze([
    ...stringArray(source.inputFactRefs, 'TypedFact.inputFactRefs'),
  ].sort(compareCanonical));
  const identityProvenanceRefs = Object.freeze([
    ...stringArray(source.identityProvenanceRefs, 'TypedFact.identityProvenanceRefs'),
  ].sort(compareCanonical));
  const body = deepFreeze({
    version: TYPED_FACT_VERSION,
    factId: requiredString(source.factId, 'TypedFact.factId'),
    factType: requiredString(source.factType, 'TypedFact.factType'),
    predicate: requiredString(source.predicate, 'TypedFact.predicate'),
    valueSchemaId: requiredString(source.valueSchemaId, 'TypedFact.valueSchemaId'),
    subjectRefs,
    value,
    stratum,
    recursionPolicy: enumValue(
      source.recursionPolicy,
      FACT_RECURSION_POLICIES,
      'TypedFact.recursionPolicy',
    ),
    derivationId: requiredString(source.derivationId, 'TypedFact.derivationId'),
    configVersion: requiredString(source.configVersion, 'TypedFact.configVersion'),
    inputFactRefs,
    natalContentHash: requiredString(source.natalContentHash, 'TypedFact.natalContentHash'),
    snapshotRef: requiredString(source.snapshotRef, 'TypedFact.snapshotRef'),
    provenance,
    identityProvenanceRefs,
  });
  const semanticHash = domainHashV1('formal.typed_fact.semantic.v1', {
    semanticSchemaVersion: TYPED_FACT_VERSION,
    factType: body.factType,
    predicate: body.predicate,
    valueSchemaId: body.valueSchemaId,
    subjectRefs: body.subjectRefs,
    value: body.value,
    stratum: body.stratum,
    recursionPolicy: body.recursionPolicy,
    configVersion: body.configVersion,
    natalContentHash: body.natalContentHash,
    snapshotRef: body.snapshotRef,
  });
  const derivationHash = domainHashV1('formal.typed_fact.derivation.v1', {
    version: TYPED_FACT_DERIVATION_VERSION,
    semanticHash,
    ruleIdentity: body.derivationId,
    premiseFactRefs: body.inputFactRefs,
    canonicalRuleParameters: { configVersion: body.configVersion },
    identityProvenanceRefs: body.identityProvenanceRefs,
  });
  const factWithoutContentHash = deepFreeze({
    ...body,
    semanticHash,
    derivationRefs: Object.freeze([derivationHash]),
    derivationHash,
  });
  const fact = deepFreeze({
    ...factWithoutContentHash,
    contentHash: domainHashV1('formal.typed_fact.content.v1', {
      semanticHash,
      derivationHashes: factWithoutContentHash.derivationRefs,
      identityProvenanceRefs: body.identityProvenanceRefs,
      record: factWithoutContentHash,
    }),
  });
  typedFacts.add(fact);
  return fact;
}

export function assertTypedFact(value, field = 'TypedFact') {
  if (!value || typeof value !== 'object' || !typedFacts.has(value)) {
    throw new TypeError(`${field} must be a factory-produced TypedFact`);
  }
  return value;
}

export function factDerivationOf(value) {
  const fact = assertTypedFact(value);
  return deepFreeze({
    version: TYPED_FACT_DERIVATION_VERSION,
    derivationHash: fact.derivationHash,
    semanticHash: fact.semanticHash,
    factId: fact.factId,
    derivationId: fact.derivationId,
    inputFactRefs: fact.inputFactRefs,
    ruleIdentity: fact.derivationId,
    premiseFactRefs: fact.inputFactRefs,
    canonicalRuleParameters: { configVersion: fact.configVersion },
    identityProvenanceRefs: fact.identityProvenanceRefs,
    provenance: fact.provenance,
  });
}
