import { PILLAR_SLOTS } from './constants.mjs';
import {
  buildValidatedPillarCoordinate,
  captureValidatedPillars,
  DIRECT_PILLAR_ENCODING_VERSION,
} from './encoding.mjs';
import { compileStructuralMaterials } from './materials.mjs';
import { assertReleaseCompilationContext } from '../release/manifest.mjs';
import { compareCanonical, domainHashV1 } from '../shared/canonical.mjs';
import { deepFreeze } from '../shared/assert.mjs';
import {
  buildTypedFact,
  factDerivationOf,
  TYPED_FACT_VERSION,
} from '../algebra/typed-fact.mjs';
import { BAZI_STRUCTURAL_CODEBOOK } from './foundation-profile.mjs';
import { elementRelationCodeOf } from './structure.mjs';

export const CANONICAL_FACT_GRAPH_VERSION = 'bazi.canonical_fact_graph.v4';
const canonicalFactGraphInstances = new WeakSet();

export const FACT_TYPE_SCHEMAS = deepFreeze({
  root_pillar: {
    predicate: 'bazi.pillar.root', valueSchemaId: 'bazi.fact_value.root_pillar.v1', stratum: 0,
  },
  stem_occurrence: {
    predicate: 'bazi.occurrence.visible_stem', valueSchemaId: 'bazi.fact_value.stem_occurrence.v1', stratum: 1,
  },
  branch_occurrence: {
    predicate: 'bazi.occurrence.branch', valueSchemaId: 'bazi.fact_value.branch_occurrence.v1', stratum: 1,
  },
  day_master: {
    predicate: 'bazi.role.day_master', valueSchemaId: 'bazi.fact_value.day_master.v1', stratum: 2,
  },
  element_polarity_assignment: {
    predicate: 'bazi.assignment.element_polarity', valueSchemaId: 'bazi.fact_value.element_polarity_assignment.v1', stratum: 2,
  },
  hidden_stem_occurrence: {
    predicate: 'bazi.occurrence.hidden_stem', valueSchemaId: 'bazi.fact_value.hidden_stem_occurrence.v1', stratum: 2,
  },
  ten_god_relation: {
    predicate: 'bazi.relation.ten_god', valueSchemaId: 'bazi.fact_value.ten_god_relation.v1', stratum: 3,
  },
  growth_stage: {
    predicate: 'bazi.relation.growth_stage', valueSchemaId: 'bazi.fact_value.growth_stage_relation.v1', stratum: 3,
  },
  directed_element_relation: {
    predicate: 'bazi.relation.element_directed', valueSchemaId: 'bazi.fact_value.directed_element_relation.v1', stratum: 3,
  },
});
export const FACT_TYPES = Object.freeze(Object.keys(FACT_TYPE_SCHEMAS));
const DERIVATION_IDS = Object.freeze(Object.fromEntries(
  FACT_TYPES.map((type) => [type, `derivation:bazi.${type}.v4`]),
));

const FIXED_VISIBLE_PAIRS = Object.freeze([
  ['year', 'month'], ['year', 'day'], ['year', 'hour'],
  ['month', 'day'], ['month', 'hour'], ['day', 'hour'],
]);
const ELEMENT_RELATION_IDS = Object.freeze(
  BAZI_STRUCTURAL_CODEBOOK.domains.elementRelations.values.map((row) => row.id),
);

const stemRef = (slot) => `pillar.${slot}.visible_stem`;
const branchRef = (slot) => `pillar.${slot}.branch`;
const hiddenRef = (slot, order) => `pillar.${slot}.branch.hidden_stem.${order}`;
const pillarRef = (slot) => `pillar.${slot}`;

export function factTypeSchemaOf(factType) {
  const schema = FACT_TYPE_SCHEMAS[factType];
  if (!schema) throw new TypeError(`unknown CanonicalFactGraph factType: ${String(factType)}`);
  return schema;
}

function factNode({ factId, factType, subjectRefs, value, configVersion, inputFactRefs, natalContentHash, snapshotRef }) {
  const schema = factTypeSchemaOf(factType);
  return buildTypedFact({
    factId,
    factType,
    predicate: schema.predicate,
    valueSchemaId: schema.valueSchemaId,
    subjectRefs: [...subjectRefs],
    value,
    stratum: schema.stratum,
    recursionPolicy: 'forwardable',
    derivationId: DERIVATION_IDS[factType],
    configVersion,
    inputFactRefs: [...inputFactRefs],
    natalContentHash,
    snapshotRef,
    provenance: {
      status: 'deterministic_manifest_scoped',
      authority: 'kernel_derivation',
      configVersion,
    },
    identityProvenanceRefs: [configVersion, natalContentHash],
  });
}

export function buildCanonicalFactGraphFromMaterials({ coordinate, structuralMaterials }) {
  const natalContentHash = structuralMaterials.foundationDependencyHash;
  const snapshotRef = natalContentHash;
  const structuralVersion = structuralMaterials.codebookVersion;
  const facts = [];
  const push = (node) => { facts.push(node); return node.factId; };
  const stemFactIds = {};
  const branchFactIds = {};

  for (const slot of PILLAR_SLOTS) {
    const pillar = structuralMaterials.pillars[slot];
    const rootFactId = push(factNode({
      factId: `fact:root_pillar:${slot}`,
      factType: 'root_pillar',
      subjectRefs: [pillarRef(slot)],
      value: { pillarPosition: slot, stemId: pillar.stem.stemId, branchId: pillar.branch.branchId },
      configVersion: DIRECT_PILLAR_ENCODING_VERSION,
      inputFactRefs: [], natalContentHash, snapshotRef,
    }));
    stemFactIds[slot] = push(factNode({
      factId: `fact:stem_occurrence:${slot}`,
      factType: 'stem_occurrence',
      subjectRefs: [stemRef(slot)],
      value: {
        occurrenceId: stemRef(slot), pillarPosition: slot, layer: 'stem',
        symbol: pillar.stem.stemId, elementId: pillar.stem.elementId,
        polarityId: pillar.stem.polarityId, sourcePillarFactRef: rootFactId,
      },
      configVersion: structuralVersion,
      inputFactRefs: [rootFactId], natalContentHash, snapshotRef,
    }));
    branchFactIds[slot] = push(factNode({
      factId: `fact:branch_occurrence:${slot}`,
      factType: 'branch_occurrence',
      subjectRefs: [branchRef(slot)],
      value: {
        occurrenceId: branchRef(slot), pillarPosition: slot, layer: 'branch',
        symbol: pillar.branch.branchId, elementId: pillar.branch.nominalElementId,
        polarityId: pillar.branch.polarityId, sourcePillarFactRef: rootFactId,
      },
      configVersion: structuralVersion,
      inputFactRefs: [rootFactId], natalContentHash, snapshotRef,
    }));
  }

  const dayMasterFactId = push(factNode({
    factId: 'fact:day_master',
    factType: 'day_master',
    subjectRefs: [stemRef('day')],
    value: {
      dayMasterOccurrenceRef: stemRef('day'), stemId: structuralMaterials.dayMaster.stemId,
      elementId: structuralMaterials.dayMaster.elementId,
      polarityId: structuralMaterials.dayMaster.polarityId,
    },
    configVersion: structuralVersion,
    inputFactRefs: [stemFactIds.day], natalContentHash, snapshotRef,
  }));

  for (const slot of PILLAR_SLOTS) {
    const pillar = structuralMaterials.pillars[slot];
    for (const [layer, occurrenceRef, elementId, polarityId, sourceFactId] of [
      ['stem', stemRef(slot), pillar.stem.elementId, pillar.stem.polarityId, stemFactIds[slot]],
      ['branch', branchRef(slot), pillar.branch.nominalElementId, pillar.branch.polarityId, branchFactIds[slot]],
    ]) {
      push(factNode({
        factId: `fact:element_polarity_assignment:${layer}:${slot}`,
        factType: 'element_polarity_assignment', subjectRefs: [occurrenceRef],
        value: {
          subjectOccurrenceRef: occurrenceRef, layer, elementId, polarityId,
          tableManifestHash: structuralMaterials.deterministicTableManifestRef.deterministicTableManifestHash,
        },
        configVersion: structuralVersion,
        inputFactRefs: [sourceFactId], natalContentHash, snapshotRef,
      }));
    }
    push(factNode({
      factId: `fact:ten_god_relation:visible:${slot}`,
      factType: 'ten_god_relation', subjectRefs: [stemRef('day'), stemRef(slot)],
      value: {
        dayMasterOccurrenceRef: stemRef('day'), targetStemOccurrenceRef: stemRef(slot),
        targetLayer: 'visible_stem', tenGodId: pillar.fromDayMaster.tenGodId,
        elementRelationId: pillar.fromDayMaster.elementRelationId,
      },
      configVersion: structuralVersion,
      inputFactRefs: [dayMasterFactId, stemFactIds[slot]], natalContentHash, snapshotRef,
    }));
    push(factNode({
      factId: `fact:growth_stage:${slot}`,
      factType: 'growth_stage', subjectRefs: [stemRef('day'), branchRef(slot)],
      value: {
        subjectStemOccurrenceRef: stemRef('day'), targetBranchOccurrenceRef: branchRef(slot),
        calculationScope: 'day_master_to_four_natal_branches',
        directionRule: structuralMaterials.dayMaster.polarityId === 'yang' ? 'forward' : 'reverse',
        stageId: pillar.growthStage.stageId,
        growthStageProfileId: structuralMaterials.growthStageProfileId,
        tableVersion: structuralVersion,
      },
      configVersion: structuralMaterials.growthStageProfileId,
      inputFactRefs: [dayMasterFactId, branchFactIds[slot]], natalContentHash, snapshotRef,
    }));
    for (const hidden of pillar.hiddenStems) {
      const occurrenceRef = hiddenRef(slot, hidden.orderIndex);
      const hiddenFactId = push(factNode({
        factId: `fact:hidden_stem_occurrence:${slot}:${hidden.orderIndex}`,
        factType: 'hidden_stem_occurrence', subjectRefs: [occurrenceRef, branchRef(slot)],
        value: {
          hiddenStemOccurrenceId: occurrenceRef, parentBranchOccurrenceId: branchRef(slot),
          stemId: hidden.stem.stemId, elementId: hidden.stem.elementId,
          polarityId: hidden.stem.polarityId, order: hidden.orderIndex,
          role: 'profile_order_only_no_weight',
          hiddenStemTableVersion: structuralMaterials.hiddenStemProfileId,
          hiddenStemTableManifestHash:
            structuralMaterials.deterministicTableManifestRef.deterministicTableManifestHash,
        },
        configVersion: structuralMaterials.hiddenStemProfileId,
        inputFactRefs: [branchFactIds[slot]], natalContentHash, snapshotRef,
      }));
      push(factNode({
        factId: `fact:ten_god_relation:hidden:${slot}:${hidden.orderIndex}`,
        factType: 'ten_god_relation', subjectRefs: [stemRef('day'), occurrenceRef],
        value: {
          dayMasterOccurrenceRef: stemRef('day'), targetStemOccurrenceRef: occurrenceRef,
          targetLayer: 'hidden_stem', tenGodId: hidden.fromDayMaster.tenGodId,
          elementRelationId: hidden.fromDayMaster.elementRelationId,
        },
        configVersion: structuralVersion,
        inputFactRefs: [dayMasterFactId, hiddenFactId], natalContentHash, snapshotRef,
      }));
    }
  }

  for (const [lane, occurrenceFactIds] of [['stem', stemFactIds], ['branch', branchFactIds]]) {
    for (const [leftSlot, rightSlot] of FIXED_VISIBLE_PAIRS) {
      const left = structuralMaterials.pillars[leftSlot][lane];
      const right = structuralMaterials.pillars[rightSlot][lane];
      const leftOccurrenceRef = lane === 'stem' ? stemRef(leftSlot) : branchRef(leftSlot);
      const rightOccurrenceRef = lane === 'stem' ? stemRef(rightSlot) : branchRef(rightSlot);
      const leftElementId = lane === 'stem' ? left.elementId : left.nominalElementId;
      const rightElementId = lane === 'stem' ? right.elementId : right.nominalElementId;
      push(factNode({
        factId: `fact:directed_element_relation:${lane}:${leftSlot}_${rightSlot}`,
        factType: 'directed_element_relation',
        subjectRefs: [leftOccurrenceRef, rightOccurrenceRef],
        value: {
          scope: 'six_fixed_visible_pillar_pairs_stems_and_branches_no_hidden_no_self',
          lane,
          pairId: `${leftSlot}_${rightSlot}`,
          leftOccurrenceRef,
          rightOccurrenceRef,
          leftToRightElementRelationId:
            ELEMENT_RELATION_IDS[elementRelationCodeOf(leftElementId, rightElementId)],
          rightToLeftElementRelationId:
            ELEMENT_RELATION_IDS[elementRelationCodeOf(rightElementId, leftElementId)],
          directionality: 'explicit_both_directions',
        },
        configVersion: structuralVersion,
        inputFactRefs: [occurrenceFactIds[leftSlot], occurrenceFactIds[rightSlot]],
        natalContentHash, snapshotRef,
      }));
    }
  }

  const frozenFacts = deepFreeze([...facts].sort(
    (left, right) => compareCanonical(left.contentHash, right.contentHash),
  ));
  const derivations = deepFreeze(frozenFacts.map(factDerivationOf).sort(
    (left, right) => compareCanonical(left.derivationHash, right.derivationHash),
  ));
  const manifestRefs = deepFreeze({
    encodingVersion: DIRECT_PILLAR_ENCODING_VERSION,
    typedFactVersion: TYPED_FACT_VERSION,
    structuralCodebookVersion: structuralMaterials.codebookVersion,
    hiddenStemProfileId: structuralMaterials.hiddenStemProfileId,
    growthStageProfileId: structuralMaterials.growthStageProfileId,
    deterministicTableManifest: structuralMaterials.deterministicTableManifestRef,
  });
  const graphBody = deepFreeze({
    version: CANONICAL_FACT_GRAPH_VERSION,
    canonicalScope: 'relation_profile_independent_manifest_scoped_typed_fact_dag',
    profileScopedCandidatesExcluded: true,
    natalContentHash,
    foundationDependencyHash: natalContentHash,
    coordinateHash: coordinate.coordinateHash,
    manifestRefs,
    factTypeSchemas: FACT_TYPE_SCHEMAS,
    factCount: frozenFacts.length,
    derivationCount: derivations.length,
    facts: frozenFacts,
    derivations,
  });
  const canonicalFactGraphHash = domainHashV1('bazi.canonical_fact_graph.v4', graphBody);
  const graph = deepFreeze({ ...graphBody, canonicalFactGraphHash });
  canonicalFactGraphInstances.add(graph);
  return graph;
}

export function deriveCanonicalFactGraph(pillars, releaseCompilationContext) {
  const releaseContext = assertReleaseCompilationContext(releaseCompilationContext);
  const coordinate = buildValidatedPillarCoordinate(captureValidatedPillars(pillars));
  return buildCanonicalFactGraphFromMaterials({
    coordinate,
    structuralMaterials: compileStructuralMaterials(coordinate, releaseContext),
  });
}

export function assertCanonicalFactGraph(graph, field = 'CanonicalFactGraph') {
  if (!graph || typeof graph !== 'object' || !canonicalFactGraphInstances.has(graph)) {
    throw new TypeError(`${field} must be a CanonicalFactGraph; factory-produced CanonicalFactGraph required`);
  }
  return graph;
}

export function buildFactView(graph) {
  const canonicalGraph = assertCanonicalFactGraph(graph);
  const byId = new Map(canonicalGraph.facts.map((fact) => [fact.factId, fact]));
  const byType = new Map(FACT_TYPES.map((type) => [type, Object.freeze(
    canonicalGraph.facts.filter((fact) => fact.factType === type),
  )]));
  const byPredicate = new Map(Object.values(FACT_TYPE_SCHEMAS).map(
    ({ predicate }) => [predicate, Object.freeze(
      canonicalGraph.facts.filter((fact) => fact.predicate === predicate),
    )],
  ));
  const bySemanticHash = new Map(canonicalGraph.facts.map(
    (fact) => [fact.semanticHash, fact],
  ));
  const byStratum = new Map();
  const bySubject = new Map();
  for (const fact of canonicalGraph.facts) {
    if (!byStratum.has(fact.stratum)) byStratum.set(fact.stratum, []);
    byStratum.get(fact.stratum).push(fact);
    for (const subjectRef of fact.subjectRefs) {
      if (!bySubject.has(subjectRef)) bySubject.set(subjectRef, []);
      bySubject.get(subjectRef).push(fact);
    }
  }
  for (const [stratum, list] of byStratum) byStratum.set(stratum, Object.freeze(list));
  for (const [subjectRef, list] of bySubject) bySubject.set(subjectRef, Object.freeze(list));
  return Object.freeze({
    version: CANONICAL_FACT_GRAPH_VERSION,
    canonicalFactGraphHash: canonicalGraph.canonicalFactGraphHash,
    natalContentHash: canonicalGraph.natalContentHash,
    foundationDependencyHash: canonicalGraph.foundationDependencyHash,
    factCount: canonicalGraph.factCount,
    factById: (factId) => byId.get(factId) ?? null,
    factBySemanticHash: (semanticHash) => bySemanticHash.get(semanticHash) ?? null,
    factsOfType: (factType) => byType.get(factType) ?? Object.freeze([]),
    factsForPredicate: (predicate) => byPredicate.get(predicate) ?? Object.freeze([]),
    factsAtStratum: (stratum) => byStratum.get(stratum) ?? Object.freeze([]),
    factsAbout: (subjectRef) => bySubject.get(subjectRef) ?? Object.freeze([]),
  });
}
