import { BRANCH_IDS, STEM_IDS } from './constants.mjs';
import { expectedHourStemId, expectedMonthStemId, sexagenaryIndex } from './encoding.mjs';
import { BAZI_STRUCTURAL_CODEBOOK } from './foundation-profile.mjs';
import { assertNatalFixedBundleV1 } from './natal-fixed-bundle.mjs';
import { matchTemporalOccurrences } from './temporal-match-index.mjs';
import { elementRelationCodeOf } from './structure.mjs';
import {
  assertResolvedReleaseContext,
  resolveSelectedRelationProfile,
} from '../release/manifest.mjs';
import {
  captureExactDataRecord,
  captureJsonData,
  deepFreeze,
  requiredString,
} from '../shared/assert.mjs';
import {
  compareCanonical,
  domainHashV1,
  parseCanonicalJsonV1,
} from '../shared/canonical.mjs';

export const TEMPORAL_LAYER_IDS = Object.freeze([
  'major_luck', 'minor_luck', 'year', 'month', 'day', 'hour',
]);
export const TEMPORAL_LAYER_CANDIDATE_VERSION = 'bazi.temporal_layer_candidate.v1';
export const TEMPORAL_CANDIDATE_ENVELOPE_VERSION = 'bazi.temporal_candidate_envelope.v1';
export const TEMPORAL_LAYER_CANDIDATE_SET_VERSION = 'bazi.temporal_layer_candidate_set.v1';
export const TEMPORAL_KERNEL_REQUEST_VERSION = 'bazi.temporal_kernel_request.v1';
export const TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION = 'bazi.temporal_kernel_request.schema.v1';
export const INTER_TEMPORAL_RELATION_SET_VERSION = 'bazi.inter_temporal_relation_set.v1';
export const TEMPORAL_FIXED_STATE_RESULT_VERSION = 'bazi.temporal_fixed_state_result.v1';
export const TEMPORAL_CANDIDATE_COMPILATION_RESULT_VERSION =
  'bazi.temporal_candidate_compilation_result.v1';
export const TEMPORAL_KERNEL_BATCH_VERSION = 'bazi.temporal_kernel_batch.v1';
export const TEMPORAL_CANDIDATE_COMPILATION_STATUSES = Object.freeze([
  'compiled', 'validation_failed', 'compilation_failed', 'internal_error', 'natal_unavailable',
]);

const HASH_PROFILE_ID = 'formal.sha256.domain_separated.v1';
const elementRelationRows = BAZI_STRUCTURAL_CODEBOOK.domains.elementRelations.values;
const stemRows = new Map(
  BAZI_STRUCTURAL_CODEBOOK.domains.stems.values.map((row) => [row.id, row]),
);
const branchRows = new Map(
  BAZI_STRUCTURAL_CODEBOOK.domains.branches.values.map((row) => [row.id, row]),
);

function hashMetadata(hashScope, hashViewSchemaVersion) {
  return deepFreeze({ hashProfileId: HASH_PROFILE_ID, hashScope, hashViewSchemaVersion });
}

function sourceObject(value, field) {
  return typeof value === 'string' || value instanceof Uint8Array
    ? parseCanonicalJsonV1(value, field)
    : value;
}

function hash(value, field) {
  const captured = requiredString(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(captured)) {
    throw new TypeError(`${field} must be a sha256 hash`);
  }
  return captured;
}

function safeInteger(value, field, { minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${field} must be a safe integer not less than ${minimum}`);
  }
  return value;
}

function stringList(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  const captured = value.map((item, index) => requiredString(item, `${field}[${index}]`));
  if (!allowEmpty && captured.length === 0) throw new TypeError(`${field} must not be empty`);
  return Object.freeze(captured);
}

function hashed(domain, body) {
  return deepFreeze({ ...body, contentHash: domainHashV1(domain, body) });
}

function relationId(fromElementId, toElementId) {
  return elementRelationRows[elementRelationCodeOf(fromElementId, toElementId)].id;
}

function captureEnvelope(value, index) {
  const field = `TemporalLayerCandidateSetV1.candidates[${index}]`;
  const source = captureExactDataRecord(value, [
    'version', 'candidateOrdinal', 'temporalCandidateId', 'calendarDecisionPathRef',
    'candidate', 'candidateEnvelopeHash',
  ], field);
  if (source.version !== TEMPORAL_CANDIDATE_ENVELOPE_VERSION) {
    throw new TypeError(`${field}.version is unsupported`);
  }
  const body = deepFreeze({
    version: source.version,
    candidateOrdinal: safeInteger(source.candidateOrdinal, `${field}.candidateOrdinal`, { minimum: 0 }),
    temporalCandidateId: requiredString(source.temporalCandidateId, `${field}.temporalCandidateId`),
    calendarDecisionPathRef: requiredString(
      source.calendarDecisionPathRef,
      `${field}.calendarDecisionPathRef`,
    ),
    candidate: deepFreeze(captureJsonData(source.candidate, `${field}.candidate`)),
  });
  const expected = domainHashV1('bazi.temporal_candidate_envelope.v1', body);
  if (source.candidateEnvelopeHash !== expected) {
    throw new TypeError(`${field}.candidateEnvelopeHash does not match its preimage`);
  }
  return deepFreeze({ ...body, candidateEnvelopeHash: expected });
}

export function buildTemporalLayerCandidateSetV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'subjectRef', 'candidates', 'provenanceRefs',
  ], 'TemporalLayerCandidateSetV1');
  if (source.version !== TEMPORAL_LAYER_CANDIDATE_SET_VERSION) {
    throw new TypeError('TemporalLayerCandidateSetV1.version is unsupported');
  }
  if (!Array.isArray(source.candidates)) {
    throw new TypeError('TemporalLayerCandidateSetV1.candidates must be an array');
  }
  const candidates = source.candidates.map((candidate, candidateOrdinal) => {
    const row = captureExactDataRecord(candidate, [
      'temporalCandidateId', 'calendarDecisionPathRef', 'candidate',
    ], `TemporalLayerCandidateSetV1.candidates[${candidateOrdinal}]`);
    const body = deepFreeze({
      version: TEMPORAL_CANDIDATE_ENVELOPE_VERSION,
      candidateOrdinal,
      temporalCandidateId: requiredString(
        row.temporalCandidateId,
        `TemporalLayerCandidateSetV1.candidates[${candidateOrdinal}].temporalCandidateId`,
      ),
      calendarDecisionPathRef: requiredString(
        row.calendarDecisionPathRef,
        `TemporalLayerCandidateSetV1.candidates[${candidateOrdinal}].calendarDecisionPathRef`,
      ),
      candidate: deepFreeze(captureJsonData(
        row.candidate,
        `TemporalLayerCandidateSetV1.candidates[${candidateOrdinal}].candidate`,
      )),
    });
    return deepFreeze({
      ...body,
      candidateEnvelopeHash: domainHashV1('bazi.temporal_candidate_envelope.v1', body),
    });
  });
  const body = deepFreeze({
    version: source.version,
    subjectRef: requiredString(source.subjectRef, 'TemporalLayerCandidateSetV1.subjectRef'),
    candidateCount: candidates.length,
    candidates,
    provenanceRefs: stringList(
      source.provenanceRefs,
      'TemporalLayerCandidateSetV1.provenanceRefs',
      { allowEmpty: false },
    ),
  });
  return deepFreeze({
    ...body,
    temporalLayerCandidateSetHash:
      domainHashV1('bazi.temporal_layer_candidate_set.v1', body),
  });
}

export function captureTemporalLayerCandidateSetV1(value) {
  const source = captureExactDataRecord(sourceObject(value, 'TemporalLayerCandidateSetV1'), [
    'version', 'subjectRef', 'candidateCount', 'candidates', 'provenanceRefs',
    'temporalLayerCandidateSetHash',
  ], 'TemporalLayerCandidateSetV1');
  if (source.version !== TEMPORAL_LAYER_CANDIDATE_SET_VERSION
    || !Array.isArray(source.candidates)
    || source.candidateCount !== source.candidates.length) {
    throw new TypeError('TemporalLayerCandidateSetV1 is malformed');
  }
  const candidates = source.candidates.map(captureEnvelope);
  const ids = new Set();
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index].candidateOrdinal !== index) {
      throw new TypeError('TemporalLayerCandidateSetV1 ordinals must be continuous and ordered');
    }
    if (ids.has(candidates[index].temporalCandidateId)) {
      throw new TypeError('TemporalLayerCandidateSetV1 temporalCandidateId values must be unique');
    }
    ids.add(candidates[index].temporalCandidateId);
  }
  const body = deepFreeze({
    version: source.version,
    subjectRef: requiredString(source.subjectRef, 'TemporalLayerCandidateSetV1.subjectRef'),
    candidateCount: candidates.length,
    candidates,
    provenanceRefs: stringList(
      source.provenanceRefs,
      'TemporalLayerCandidateSetV1.provenanceRefs',
      { allowEmpty: false },
    ),
  });
  const expected = domainHashV1('bazi.temporal_layer_candidate_set.v1', body);
  if (source.temporalLayerCandidateSetHash !== expected) {
    throw new TypeError('TemporalLayerCandidateSetV1 hash does not match its preimage');
  }
  return deepFreeze({ ...body, temporalLayerCandidateSetHash: expected });
}

export function buildTemporalKernelRequestV1(input) {
  const source = captureExactDataRecord(input, [
    'version', 'requestSchemaVersion', 'natalFixedBundleHash',
    'temporalLayerCandidateSetHash', 'releaseManifestHash', 'activeProfileId',
    'subjectRef', 'targetRangeRef', 'provenanceRefs', 'metadata',
  ], 'TemporalKernelRequestV1');
  if (source.version !== TEMPORAL_KERNEL_REQUEST_VERSION
    || source.requestSchemaVersion !== TEMPORAL_KERNEL_REQUEST_SCHEMA_VERSION) {
    throw new TypeError('TemporalKernelRequestV1 version or schema version is unsupported');
  }
  const body = deepFreeze({
    version: source.version,
    requestSchemaVersion: source.requestSchemaVersion,
    natalFixedBundleHash: hash(
      source.natalFixedBundleHash,
      'TemporalKernelRequestV1.natalFixedBundleHash',
    ),
    temporalLayerCandidateSetHash: hash(
      source.temporalLayerCandidateSetHash,
      'TemporalKernelRequestV1.temporalLayerCandidateSetHash',
    ),
    releaseManifestHash: hash(
      source.releaseManifestHash,
      'TemporalKernelRequestV1.releaseManifestHash',
    ),
    activeProfileId: requiredString(
      source.activeProfileId,
      'TemporalKernelRequestV1.activeProfileId',
    ),
    subjectRef: requiredString(source.subjectRef, 'TemporalKernelRequestV1.subjectRef'),
    targetRangeRef: requiredString(
      source.targetRangeRef,
      'TemporalKernelRequestV1.targetRangeRef',
    ),
    provenanceRefs: stringList(
      source.provenanceRefs,
      'TemporalKernelRequestV1.provenanceRefs',
      { allowEmpty: false },
    ),
  });
  return deepFreeze({
    ...body,
    requestHash: domainHashV1('bazi.temporal_kernel_request.v1', body),
    ...(Object.hasOwn(source, 'metadata')
      ? { metadata: deepFreeze(captureJsonData(source.metadata, 'TemporalKernelRequestV1.metadata')) }
      : {}),
  });
}

export function captureTemporalKernelRequestV1(value) {
  const source = captureExactDataRecord(sourceObject(value, 'TemporalKernelRequestV1'), [
    'version', 'requestSchemaVersion', 'natalFixedBundleHash',
    'temporalLayerCandidateSetHash', 'releaseManifestHash', 'activeProfileId',
    'subjectRef', 'targetRangeRef', 'provenanceRefs', 'requestHash', 'metadata',
  ], 'TemporalKernelRequestV1');
  const { requestHash, ...input } = source;
  const request = buildTemporalKernelRequestV1(input);
  if (requestHash !== request.requestHash) {
    throw new TypeError('TemporalKernelRequestV1.requestHash does not match its preimage');
  }
  return request;
}

function captureLayer(value, index, candidate, occurrenceIds) {
  const field = `TemporalLayerCandidateV1.layers[${index}]`;
  const source = captureExactDataRecord(value, [
    'layerId', 'pillarOccurrenceId', 'stemOccurrenceId', 'branchOccurrenceId',
    'subjectRef', 'stemId', 'branchId', 'validFromMs', 'validUntilMs', 'termRef',
    'sourceTimeRef', 'sourceRefs', 'authorityRef', 'calculationProfileRef',
    'calendarBasisRef', 'boundaryProfileRef', 'locationTimeRef',
    'inputDependencyRefs', 'decisionRefs',
  ], field);
  if (!TEMPORAL_LAYER_IDS.includes(source.layerId)) {
    throw new RangeError(`${field}.layerId is unsupported`);
  }
  const subjectSpecific = source.layerId === 'major_luck' || source.layerId === 'minor_luck';
  if (subjectSpecific ? source.subjectRef !== candidate.subjectRef : source.subjectRef !== null) {
    throw new TypeError(`${field}.subjectRef does not match layer semantics`);
  }
  const stemId = requiredString(source.stemId, `${field}.stemId`);
  const branchId = requiredString(source.branchId, `${field}.branchId`);
  if (!STEM_IDS.includes(stemId) || !BRANCH_IDS.includes(branchId)) {
    throw new RangeError(`${field} contains an unsupported stem or branch`);
  }
  sexagenaryIndex({ stemId, branchId });
  const validFromMs = safeInteger(source.validFromMs, `${field}.validFromMs`);
  const validUntilMs = safeInteger(source.validUntilMs, `${field}.validUntilMs`);
  if (validFromMs >= validUntilMs
    || candidate.targetInstantMs < validFromMs
    || candidate.targetInstantMs >= validUntilMs) {
    throw new RangeError(`${field} does not contain targetInstantMs in a positive half-open interval`);
  }
  const pillarOccurrenceId = requiredString(source.pillarOccurrenceId, `${field}.pillarOccurrenceId`);
  const stemOccurrenceId = requiredString(source.stemOccurrenceId, `${field}.stemOccurrenceId`);
  const branchOccurrenceId = requiredString(source.branchOccurrenceId, `${field}.branchOccurrenceId`);
  for (const occurrenceId of [pillarOccurrenceId, stemOccurrenceId, branchOccurrenceId]) {
    if (occurrenceIds.has(occurrenceId)) {
      throw new TypeError('TemporalLayerCandidateV1 occurrence identities must be unique');
    }
    occurrenceIds.add(occurrenceId);
  }
  const body = deepFreeze({
    layerId: source.layerId,
    pillarOccurrenceId,
    stemOccurrenceId,
    branchOccurrenceId,
    subjectRef: source.subjectRef,
    stemId,
    branchId,
    validFromMs,
    validUntilMs,
    termRef: requiredString(source.termRef, `${field}.termRef`),
    sourceTimeRef: requiredString(source.sourceTimeRef, `${field}.sourceTimeRef`),
    sourceRefs: stringList(source.sourceRefs, `${field}.sourceRefs`, { allowEmpty: false }),
    authorityRef: requiredString(source.authorityRef, `${field}.authorityRef`),
    calculationProfileRef: requiredString(
      source.calculationProfileRef,
      `${field}.calculationProfileRef`,
    ),
    calendarBasisRef: requiredString(source.calendarBasisRef, `${field}.calendarBasisRef`),
    boundaryProfileRef: requiredString(
      source.boundaryProfileRef,
      `${field}.boundaryProfileRef`,
    ),
    locationTimeRef: requiredString(source.locationTimeRef, `${field}.locationTimeRef`),
    inputDependencyRefs: stringList(
      source.inputDependencyRefs,
      `${field}.inputDependencyRefs`,
    ),
    decisionRefs: stringList(source.decisionRefs, `${field}.decisionRefs`),
  });
  return deepFreeze({
    ...body,
    temporalLayerHash: domainHashV1('bazi.temporal_layer_occurrence.v1', body),
  });
}

function validateTemporalCandidate(envelope, subjectRef) {
  const source = captureExactDataRecord(envelope.candidate, [
    'version', 'subjectRef', 'targetInstantMs', 'targetTimeRef', 'layers', 'provenanceRefs',
  ], 'TemporalLayerCandidateV1');
  if (source.version !== TEMPORAL_LAYER_CANDIDATE_VERSION) {
    throw new TypeError('TemporalLayerCandidateV1.version is unsupported');
  }
  const candidate = {
    subjectRef: requiredString(source.subjectRef, 'TemporalLayerCandidateV1.subjectRef'),
    targetInstantMs: safeInteger(
      source.targetInstantMs,
      'TemporalLayerCandidateV1.targetInstantMs',
    ),
  };
  if (candidate.subjectRef !== subjectRef) {
    throw new TypeError('TemporalLayerCandidateV1.subjectRef differs from the candidate set');
  }
  if (!Array.isArray(source.layers) || source.layers.length !== TEMPORAL_LAYER_IDS.length) {
    throw new TypeError('TemporalLayerCandidateV1.layers must contain exactly six records');
  }
  const occurrenceIds = new Set();
  const captured = source.layers.map((layer, index) => (
    captureLayer(layer, index, candidate, occurrenceIds)
  ));
  const byLayer = new Map();
  for (const layer of captured) {
    if (byLayer.has(layer.layerId)) throw new TypeError(`duplicate temporal layer: ${layer.layerId}`);
    byLayer.set(layer.layerId, layer);
  }
  const layers = TEMPORAL_LAYER_IDS.map((layerId) => byLayer.get(layerId));
  if (layers[3].stemId !== expectedMonthStemId(layers[2].stemId, layers[3].branchId)) {
    throw new RangeError('TemporalLayerCandidateV1 month violates the five-tigers rule');
  }
  if (layers[5].stemId !== expectedHourStemId(layers[4].stemId, layers[5].branchId)) {
    throw new RangeError('TemporalLayerCandidateV1 hour violates the five-rats rule');
  }
  const body = deepFreeze({
    version: source.version,
    candidateOrdinal: envelope.candidateOrdinal,
    temporalCandidateId: envelope.temporalCandidateId,
    calendarDecisionPathRef: envelope.calendarDecisionPathRef,
    subjectRef: candidate.subjectRef,
    targetInstantMs: candidate.targetInstantMs,
    targetTimeRef: requiredString(source.targetTimeRef, 'TemporalLayerCandidateV1.targetTimeRef'),
    layers,
    provenanceRefs: stringList(
      source.provenanceRefs,
      'TemporalLayerCandidateV1.provenanceRefs',
      { allowEmpty: false },
    ),
  });
  return deepFreeze({
    ...body,
    temporalCandidateHash: domainHashV1('bazi.temporal_layer_candidate.v1', body),
  });
}

function pillarSide(layer) {
  return {
    layerId: layer.layerId,
    pillarOccurrenceId: layer.pillarOccurrenceId,
    stemOccurrenceId: layer.stemOccurrenceId,
    branchOccurrenceId: layer.branchOccurrenceId,
    stemId: layer.stemId,
    branchId: layer.branchId,
  };
}

function pairBranchMatches(left, right, profile) {
  const matches = [];
  for (const [relationIdValue, pairs] of Object.entries(profile.branchPairCandidates)) {
    for (const [sourceSymbol, targetSymbol] of pairs) {
      if (relationIdValue === 'punishment') {
        if (sourceSymbol === targetSymbol
          && left.branchId === sourceSymbol && right.branchId === targetSymbol) {
          const body = {
            version: 'bazi.inter_temporal_structural_match.v1',
            relationRuleId: 'bazi.relation_rule.branch_punishment.v1',
            membership: 'complete_membership',
            directionality: 'undirected_distinct_occurrences',
            roleBindings: [
              { role: 'member_0', occurrenceRef: left.branchOccurrenceId },
              { role: 'member_1', occurrenceRef: right.branchOccurrenceId },
            ],
            occurrenceRefs: [left.branchOccurrenceId, right.branchOccurrenceId],
            requiredSymbols: [sourceSymbol, targetSymbol],
            missingRequirements: [],
          };
          matches.push(hashed('bazi.inter_temporal_structural_match.v1', body));
        } else if (left.branchId === sourceSymbol && right.branchId === targetSymbol) {
          const body = {
            version: 'bazi.inter_temporal_structural_match.v1',
            relationRuleId: 'bazi.relation_rule.branch_punishment.v1',
            membership: 'complete_membership',
            directionality: 'directed',
            roleBindings: [
              { role: 'source', occurrenceRef: left.branchOccurrenceId },
              { role: 'target', occurrenceRef: right.branchOccurrenceId },
            ],
            occurrenceRefs: [left.branchOccurrenceId, right.branchOccurrenceId],
            requiredSymbols: [sourceSymbol, targetSymbol],
            missingRequirements: [],
          };
          matches.push(hashed('bazi.inter_temporal_structural_match.v1', body));
        } else if (right.branchId === sourceSymbol && left.branchId === targetSymbol) {
          const body = {
            version: 'bazi.inter_temporal_structural_match.v1',
            relationRuleId: 'bazi.relation_rule.branch_punishment.v1',
            membership: 'complete_membership',
            directionality: 'directed',
            roleBindings: [
              { role: 'source', occurrenceRef: right.branchOccurrenceId },
              { role: 'target', occurrenceRef: left.branchOccurrenceId },
            ],
            occurrenceRefs: [right.branchOccurrenceId, left.branchOccurrenceId],
            requiredSymbols: [sourceSymbol, targetSymbol],
            missingRequirements: [],
          };
          matches.push(hashed('bazi.inter_temporal_structural_match.v1', body));
        }
      } else if ((left.branchId === sourceSymbol && right.branchId === targetSymbol)
        || (right.branchId === sourceSymbol && left.branchId === targetSymbol)) {
        const body = {
          version: 'bazi.inter_temporal_structural_match.v1',
          relationRuleId: `bazi.relation_rule.branch_${relationIdValue}.v1`,
          membership: 'complete_membership',
          directionality: 'undirected',
          roleBindings: [
            { role: 'member_0', occurrenceRef: left.branchOccurrenceId },
            { role: 'member_1', occurrenceRef: right.branchOccurrenceId },
          ],
          occurrenceRefs: [left.branchOccurrenceId, right.branchOccurrenceId],
          requiredSymbols: [sourceSymbol, targetSymbol],
          missingRequirements: [],
        };
        matches.push(hashed('bazi.inter_temporal_structural_match.v1', body));
      }
    }
  }
  return matches;
}

function compilePillarPair(left, right, pairOrdinal, profile, selectedProfileHash) {
  const leftStem = stemRows.get(left.stemId);
  const rightStem = stemRows.get(right.stemId);
  const leftBranch = branchRows.get(left.branchId);
  const rightBranch = branchRows.get(right.branchId);
  const structuralMatches = [];
  const stemCombination = profile.stemCombinationPairs.find((rule) => (
    rule.memberStemIds.includes(left.stemId) && rule.memberStemIds.includes(right.stemId)
  ));
  if (stemCombination) {
    const body = {
      version: 'bazi.inter_temporal_structural_match.v1',
      relationRuleId: 'bazi.relation_rule.stem_five_combination.v1',
      membership: 'complete_membership',
      directionality: 'undirected',
      roleBindings: [
        { role: 'member_0', occurrenceRef: left.stemOccurrenceId },
        { role: 'member_1', occurrenceRef: right.stemOccurrenceId },
      ],
      occurrenceRefs: [left.stemOccurrenceId, right.stemOccurrenceId],
      requiredSymbols: stemCombination.memberStemIds,
      missingRequirements: [],
      traditionalCorrespondence: {
        elementId: stemCombination.traditionalCorrespondenceElementId,
        semantics: 'relation_rule_correspondence_only_not_transformation',
      },
    };
    structuralMatches.push(hashed('bazi.inter_temporal_structural_match.v1', body));
  }
  structuralMatches.push(...pairBranchMatches(left, right, profile));
  structuralMatches.sort((a, b) => compareCanonical(a.contentHash, b.contentHash));
  const body = deepFreeze({
    version: 'bazi.inter_temporal_pillar_pair.v1',
    pairOrdinal,
    left: pillarSide(left),
    right: pillarSide(right),
    stemElementRelations: {
      leftToRight: relationId(leftStem.elementId, rightStem.elementId),
      rightToLeft: relationId(rightStem.elementId, leftStem.elementId),
    },
    branchElementRelations: {
      leftToRight: relationId(leftBranch.nominalElementId, rightBranch.nominalElementId),
      rightToLeft: relationId(rightBranch.nominalElementId, leftBranch.nominalElementId),
    },
    structuralMatches,
    selectedRelationProfileHash: selectedProfileHash,
  });
  return deepFreeze({
    ...body,
    pairHash: domainHashV1('bazi.inter_temporal_pillar_pair.v1', body),
  });
}

function cartesian(options, prefix = [], output = []) {
  if (options.length === 0) {
    output.push(prefix);
    return output;
  }
  for (const item of options[0]) cartesian(options.slice(1), [...prefix, item], output);
  return output;
}

function compileCompleteGroups(layers, profile, selectedProfileHash) {
  const byBranch = new Map();
  for (const layer of layers) {
    if (!byBranch.has(layer.branchId)) byBranch.set(layer.branchId, []);
    byBranch.get(layer.branchId).push(layer);
  }
  const groups = [];
  for (const group of profile.completeHyperedgeGroups) {
    if (group.memberBranchIds.some((branchId) => !byBranch.has(branchId))) continue;
    for (const participants of cartesian(group.memberBranchIds.map((id) => byBranch.get(id)))) {
      const body = deepFreeze({
        version: 'bazi.inter_temporal_complete_group.v1',
        groupId: group.id,
        relationRuleId: `bazi.relation_rule.${group.relationId}.${group.id}.v1`,
        membership: 'complete_membership',
        directionality: group.relationId === 'punishment_group'
          ? 'ordered_by_profile_roles'
          : 'undirected_hyperedge',
        roleBindings: participants.map((participant, index) => ({
          role: `member_${index}`,
          occurrenceRef: participant.branchOccurrenceId,
        })),
        occurrenceRefs: participants.map((participant) => participant.branchOccurrenceId),
        requiredSymbols: group.memberBranchIds,
        missingRequirements: [],
        selectedRelationProfileHash: selectedProfileHash,
      });
      groups.push(deepFreeze({
        ...body,
        groupHash: domainHashV1('bazi.inter_temporal_complete_group.v1', body),
      }));
    }
  }
  groups.sort((a, b) => compareCanonical(a.groupHash, b.groupHash));
  return Object.freeze(groups);
}

function compileInterTemporalRelations(candidate, selected, releaseContext) {
  const pairs = [];
  let pairOrdinal = 0;
  for (let left = 0; left < candidate.layers.length; left += 1) {
    for (let right = left + 1; right < candidate.layers.length; right += 1) {
      pairs.push(compilePillarPair(
        candidate.layers[left],
        candidate.layers[right],
        pairOrdinal,
        selected.profile,
        selected.selectedRelationProfileHash,
      ));
      pairOrdinal += 1;
    }
  }
  const completeGroups = compileCompleteGroups(
    candidate.layers,
    selected.profile,
    selected.selectedRelationProfileHash,
  );
  const body = deepFreeze({
    version: INTER_TEMPORAL_RELATION_SET_VERSION,
    temporalCandidateHash: candidate.temporalCandidateHash,
    temporalLayerHashes: candidate.layers.map((layer) => layer.temporalLayerHash),
    pillarPairCount: pairs.length,
    pairs,
    completeGroupCount: completeGroups.length,
    completeGroups,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    profileId: selected.profileId,
    profileContentHash: selected.profileContentHash,
    deterministicTableManifestHash:
      releaseContext.componentHashes.deterministicTableManifestHash,
    relationProfileRegistryHash: releaseContext.componentHashes.relationProfileRegistryHash,
    relationClosure: {
      policy: 'all_declared_occurrence_pairs_once',
      maximumDerivedDepth: 1,
      syntheticOccurrenceCreation: false,
      candidateTransformationReentry: false,
    },
    hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.inter_temporal_relation_set_hash_view.v1'),
  });
  return deepFreeze({
    ...body,
    interTemporalRelationSetHash:
      domainHashV1('bazi.inter_temporal_relation_set.v1', body),
  });
}

function temporalOccurrences(candidate) {
  return Object.freeze(candidate.layers.flatMap((layer) => [
    deepFreeze({
      occurrenceId: layer.stemOccurrenceId,
      layer: layer.layerId,
      slot: 'stem',
      stemId: layer.stemId,
      sourceTimeRef: layer.sourceTimeRef,
    }),
    deepFreeze({
      occurrenceId: layer.branchOccurrenceId,
      layer: layer.layerId,
      slot: 'branch',
      branchId: layer.branchId,
      sourceTimeRef: layer.sourceTimeRef,
    }),
  ]));
}

function projectTemporalMaterials(candidate, state) {
  const index = state.temporalMatchIndex;
  const layers = candidate.layers.map((layer) => {
    const stem = index.byStem[layer.stemId];
    const branch = index.byBranch[layer.branchId];
    const body = deepFreeze({
      version: 'bazi.temporal_layer_material_projection.v1',
      layerId: layer.layerId,
      pillarOccurrenceRef: layer.pillarOccurrenceId,
      stem: {
        occurrenceRef: layer.stemOccurrenceId,
        stemId: stem.stemId,
        stemCode: stem.stemCode,
        elementId: stem.elementId,
        polarityId: stem.polarityId,
        tenGodId: stem.relativeToDayMaster.tenGodId,
        dayMasterToTemporalElementRelationId:
          stem.relativeToDayMaster.dayMasterToTemporalElementRelationId,
        dayMasterFactRef: stem.relativeToDayMaster.dayMasterFactRef,
      },
      branch: {
        occurrenceRef: layer.branchOccurrenceId,
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        nominalElementId: branch.nominalElementId,
        polarityId: branch.polarityId,
        hiddenStemOccurrences: branch.hiddenStems.map((hidden) => ({
          occurrenceId: `${layer.branchOccurrenceId}.hidden.${hidden.orderIndex}`,
          parentBranchOccurrenceRef: layer.branchOccurrenceId,
          orderIndex: hidden.orderIndex,
          stemId: hidden.stemId,
          stemCode: hidden.stemCode,
          tenGodId: hidden.tenGodId,
          hiddenStemProfileId: hidden.hiddenStemProfileId,
          orderSemantics: hidden.orderSemantics,
        })),
        growthStage: {
          subjectFactRef: branch.dayMasterGrowthStage.dayMasterFactRef,
          targetBranchOccurrenceRef: layer.branchOccurrenceId,
          stageId: branch.dayMasterGrowthStage.stageId,
          growthStageProfileId: branch.dayMasterGrowthStage.growthStageProfileId,
        },
      },
      temporalMatchIndexHash: index.temporalMatchIndexHash,
    });
    return deepFreeze({
      ...body,
      materialProjectionHash:
        domainHashV1('bazi.temporal_layer_material_projection.v1', body),
    });
  });
  const body = deepFreeze({
    version: 'bazi.temporal_material_projection_set.v1',
    temporalCandidateHash: candidate.temporalCandidateHash,
    fixedStateHash: state.fixedStateHash,
    layerCount: layers.length,
    layers,
    temporalMatchIndexHash: index.temporalMatchIndexHash,
    hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.temporal_material_projection_set_hash_view.v1'),
  });
  return deepFreeze({
    ...body,
    temporalMaterialProjectionSetHash:
      domainHashV1('bazi.temporal_material_projection_set.v1', body),
  });
}

function compileMixedCompleteGroups(candidate, state, selected) {
  const participants = [
    ...Object.entries(state.coordinates.pillars).map(([slot, pillar]) => ({
      occurrenceId: `pillar.${slot}.branch`,
      branchId: pillar.branchId,
      scope: 'natal',
    })),
    ...candidate.layers.map((layer) => ({
      occurrenceId: layer.branchOccurrenceId,
      branchId: layer.branchId,
      scope: 'temporal',
    })),
  ];
  const byBranch = new Map();
  for (const participant of participants) {
    if (!byBranch.has(participant.branchId)) byBranch.set(participant.branchId, []);
    byBranch.get(participant.branchId).push(participant);
  }
  const groups = [];
  for (const group of selected.profile.completeHyperedgeGroups) {
    if (group.memberBranchIds.some((branchId) => !byBranch.has(branchId))) continue;
    for (const selection of cartesian(group.memberBranchIds.map((id) => byBranch.get(id)))) {
      const scopes = new Set(selection.map((participant) => participant.scope));
      if (scopes.size !== 2) continue;
      const body = deepFreeze({
        version: 'bazi.mixed_temporal_natal_complete_group.v1',
        groupId: group.id,
        relationRuleId: `bazi.relation_rule.${group.relationId}.${group.id}.v1`,
        membership: 'complete_membership',
        directionality: group.relationId === 'punishment_group'
          ? 'ordered_by_profile_roles'
          : 'undirected_hyperedge',
        roleBindings: selection.map((participant, index) => ({
          role: `member_${index}`,
          occurrenceRef: participant.occurrenceId,
          scope: participant.scope,
        })),
        occurrenceRefs: selection.map((participant) => participant.occurrenceId),
        requiredSymbols: group.memberBranchIds,
        missingRequirements: [],
        selectedRelationProfileHash: selected.selectedRelationProfileHash,
      });
      groups.push(deepFreeze({
        ...body,
        groupHash: domainHashV1('bazi.mixed_temporal_natal_complete_group.v1', body),
      }));
    }
  }
  groups.sort((left, right) => compareCanonical(left.groupHash, right.groupHash));
  const body = deepFreeze({
    version: 'bazi.mixed_temporal_natal_complete_group_set.v1',
    temporalCandidateHash: candidate.temporalCandidateHash,
    fixedStateHash: state.fixedStateHash,
    groupCount: groups.length,
    groups,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.mixed_temporal_natal_complete_group_set_hash_view.v1'),
  });
  return deepFreeze({
    ...body,
    mixedCompleteGroupSetHash:
      domainHashV1('bazi.mixed_temporal_natal_complete_group_set.v1', body),
  });
}

function compileFixedStateResult(candidate, state, bundle, selected) {
  const rawStructuralMatchSet = matchTemporalOccurrences(
    state,
    temporalOccurrences(candidate),
    selected,
  );
  const pathBindingHashes = bundle.pathBindings
    .filter((binding) => binding.fixedStateRef === state.fixedStateHash)
    .map((binding) => binding.pathBindingHash)
    .sort(compareCanonical);
  const temporalMaterialProjectionSet = projectTemporalMaterials(candidate, state);
  const mixedCompleteGroupSet = compileMixedCompleteGroups(candidate, state, selected);
  const body = deepFreeze({
    version: TEMPORAL_FIXED_STATE_RESULT_VERSION,
    temporalCandidateHash: candidate.temporalCandidateHash,
    fixedStateHash: state.fixedStateHash,
    pathBindingHashes,
    natalTemporalPillarPairSlotCount: TEMPORAL_LAYER_IDS.length * 4,
    temporalMaterialProjectionSet,
    rawStructuralMatchSet,
    mixedCompleteGroupSet,
    hashMetadata: hashMetadata('lineage_bound_instance', 'bazi.temporal_fixed_state_result_hash_view.v1'),
  });
  return deepFreeze({
    ...body,
    temporalFixedStateResultHash:
      domainHashV1('bazi.temporal_fixed_state_result.v1', body),
  });
}

function phaseHook(hooks, phase, envelope) {
  if (hooks?.onPhase) hooks.onPhase(phase, envelope);
}

function stableErrorCode(status, phase, error) {
  const category = error instanceof RangeError ? 'range'
    : error instanceof TypeError ? 'type'
      : 'runtime';
  return `bazi.temporal.${status}.${phase}.${category}`;
}

function failureResult(envelope, request, releaseContext, selected, phase, error) {
  const stableDomainError = error instanceof TypeError || error instanceof RangeError;
  const status = phase === 'candidate_validation' && stableDomainError
    ? 'validation_failed'
    : stableDomainError ? 'compilation_failed' : 'internal_error';
  const stableCode = stableErrorCode(status, phase, error);
  const deterministic = status !== 'internal_error';
  const diagnosticHash = domainHashV1('bazi.temporal_candidate_failure_diagnostic.v1', {
    stableErrorCode: stableCode,
    failedPhase: phase,
    errorName: error?.name ?? 'Error',
    ...(deterministic ? { stableMessage: error?.message ?? String(error) } : {}),
  });
  const body = deepFreeze({
    version: TEMPORAL_CANDIDATE_COMPILATION_RESULT_VERSION,
    status,
    candidateOrdinal: envelope.candidateOrdinal,
    temporalCandidateId: envelope.temporalCandidateId,
    candidateEnvelopeHash: envelope.candidateEnvelopeHash,
    requestHash: request.requestHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    failedPhase: phase,
    stableErrorCode: stableCode,
    diagnosticHash,
    retryable: status === 'internal_error',
    deterministic,
  });
  return deepFreeze({
    ...body,
    resultHash: domainHashV1('bazi.temporal_candidate_compilation_result.v1', body),
    diagnostics: deepFreeze({
      errorName: error?.name ?? 'Error',
      message: error?.message ?? String(error),
    }),
  });
}

function unavailableResult(envelope, candidate, request, releaseContext, selected) {
  const body = deepFreeze({
    version: TEMPORAL_CANDIDATE_COMPILATION_RESULT_VERSION,
    status: 'natal_unavailable',
    candidateOrdinal: envelope.candidateOrdinal,
    temporalCandidateId: envelope.temporalCandidateId,
    candidateEnvelopeHash: envelope.candidateEnvelopeHash,
    temporalCandidateHash: candidate.temporalCandidateHash,
    requestHash: request.requestHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    stableErrorCode: 'bazi.temporal.natal_unavailable.no_fixed_state',
    retryable: false,
    deterministic: true,
  });
  return deepFreeze({
    ...body,
    resultHash: domainHashV1('bazi.temporal_candidate_compilation_result.v1', body),
  });
}

function successResult(
  envelope,
  candidate,
  interTemporalRelationSet,
  fixedStateResults,
  request,
  releaseContext,
  selected,
) {
  const body = deepFreeze({
    version: TEMPORAL_CANDIDATE_COMPILATION_RESULT_VERSION,
    status: 'compiled',
    candidateOrdinal: envelope.candidateOrdinal,
    temporalCandidateId: envelope.temporalCandidateId,
    candidateEnvelopeHash: envelope.candidateEnvelopeHash,
    temporalCandidateHash: candidate.temporalCandidateHash,
    requestHash: request.requestHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    candidate,
    interTemporalRelationSet,
    fixedStateResultCount: fixedStateResults.length,
    fixedStateResults,
    judgmentStatus: 'not_evaluated',
    causalStatus: 'not_modeled',
    effectEligible: false,
  });
  return deepFreeze({
    ...body,
    resultHash: domainHashV1('bazi.temporal_candidate_compilation_result.v1', body),
  });
}

function validateInputs(requestValue, setValue, bundleValue, releaseContextValue) {
  const releaseContext = assertResolvedReleaseContext(releaseContextValue);
  const request = captureTemporalKernelRequestV1(requestValue);
  const candidateSet = captureTemporalLayerCandidateSetV1(setValue);
  const bundle = assertNatalFixedBundleV1(bundleValue);
  if (request.temporalLayerCandidateSetHash !== candidateSet.temporalLayerCandidateSetHash
    || request.natalFixedBundleHash !== bundle.bundleHash
    || request.releaseManifestHash !== releaseContext.releaseManifestHash) {
    throw new TypeError('TemporalKernelRequestV1 hash references do not match supplied inputs');
  }
  if (request.subjectRef !== candidateSet.subjectRef
    || request.subjectRef !== bundle.subjectContext.subjectRef) {
    throw new TypeError('temporal request, candidate set and natal bundle subjectRef differ');
  }
  const selected = resolveSelectedRelationProfile(releaseContext, request.activeProfileId);
  if (bundle.release.releaseManifestHash !== releaseContext.releaseManifestHash
    || bundle.release.profileId !== selected.profileId
    || bundle.release.selectedRelationProfileHash !== selected.selectedRelationProfileHash) {
    throw new TypeError('NatalFixedBundleV1 does not belong to the selected admitted release');
  }
  return { releaseContext, request, candidateSet, bundle, selected };
}

export function compileTemporalRequestWithHooks(
  requestValue,
  candidateSetValue,
  natalFixedBundleValue,
  releaseContextValue,
  hooks = null,
) {
  const {
    releaseContext, request, candidateSet, bundle, selected,
  } = validateInputs(requestValue, candidateSetValue, natalFixedBundleValue, releaseContextValue);
  const fixedStates = Object.values(bundle.fixedStatesByHash).sort(
    (left, right) => compareCanonical(left.fixedStateHash, right.fixedStateHash),
  );
  const results = candidateSet.candidates.map((envelope) => {
    const tracker = { phase: 'candidate_validation' };
    try {
      phaseHook(hooks, tracker.phase, envelope);
      const candidate = validateTemporalCandidate(envelope, candidateSet.subjectRef);
      if (fixedStates.length === 0) {
        return unavailableResult(envelope, candidate, request, releaseContext, selected);
      }
      tracker.phase = 'inter_temporal_relation_compilation';
      phaseHook(hooks, tracker.phase, envelope);
      const interTemporalRelationSet = compileInterTemporalRelations(
        candidate,
        selected,
        releaseContext,
      );
      tracker.phase = 'natal_temporal_matching';
      phaseHook(hooks, tracker.phase, envelope);
      const fixedStateResults = fixedStates.map((state) => (
        compileFixedStateResult(candidate, state, bundle, selected)
      ));
      tracker.phase = 'candidate_finalization';
      phaseHook(hooks, tracker.phase, envelope);
      return successResult(
        envelope,
        candidate,
        interTemporalRelationSet,
        fixedStateResults,
        request,
        releaseContext,
        selected,
      );
    } catch (error) {
      return failureResult(
        envelope,
        request,
        releaseContext,
        selected,
        tracker.phase,
        error,
      );
    }
  });
  const counts = Object.fromEntries(TEMPORAL_CANDIDATE_COMPILATION_STATUSES.map(
    (status) => [status, results.filter((result) => result.status === status).length],
  ));
  const status = results.length === 0 ? 'empty'
    : counts.compiled === results.length ? 'compiled'
      : counts.compiled === 0 ? 'failed' : 'partial_failure';
  const identity = deepFreeze({
    version: TEMPORAL_KERNEL_BATCH_VERSION,
    requestHash: request.requestHash,
    temporalLayerCandidateSetHash: candidateSet.temporalLayerCandidateSetHash,
    natalFixedBundleHash: bundle.bundleHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    selectedRelationProfileHash: selected.selectedRelationProfileHash,
    inputCount: candidateSet.candidateCount,
    resultCount: results.length,
    status,
    counts,
    resultHashes: results.map((result) => result.resultHash),
    judgmentStatus: 'not_evaluated',
    causalStatus: 'not_modeled',
    effectEligible: false,
  });
  return deepFreeze({
    ...identity,
    results,
    temporalKernelBatchHash: domainHashV1('bazi.temporal_kernel_batch.v1', identity),
    ...(request.metadata == null ? {} : { requestMetadata: request.metadata }),
  });
}

export function compileTemporalRequest(
  requestValue,
  candidateSetValue,
  natalFixedBundleValue,
  releaseContextValue,
) {
  return compileTemporalRequestWithHooks(
    requestValue,
    candidateSetValue,
    natalFixedBundleValue,
    releaseContextValue,
  );
}
