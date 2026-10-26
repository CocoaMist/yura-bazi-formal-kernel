import {
  captureChartRecord,
  captureResolvedTimeQuery,
  captureSixLayerTemporalInput
} from './contracts.mjs';
import {
  PILLAR_SLOTS,
  RAW_RELATION_PROFILE,
  SIX_LAYER_TEMPORAL_IDS,
  SIX_LAYER_TEMPORAL_PROFILE,
  TIME_LAYERS
} from './profile.mjs';
import { detectCompleteBranchGroups, relatePillars } from './relations.mjs';
import { groupAllowedByScopeProfile, TEMPORAL_SCOPE_PROFILE } from './scope-profile.mjs';
import { matchCapturedLifeStageCandidates } from './life-stage.mjs';
import { captureRecord, contentHash, deepFreeze } from './shared.mjs';

function natalSide(chart, slot) {
  return {
    pillar: chart.pillars[slot],
    occurrence: {
      occurrenceId: `natal.${slot}`,
      scope: 'natal',
      location: slot,
      subjectRef: chart.subjectRef
    }
  };
}

function timeSide(layer, pillar) {
  return {
    pillar,
    occurrence: {
      occurrenceId: `time.${layer}`,
      scope: 'time',
      location: layer,
      subjectRef: null
    }
  };
}

function explicitTimeSide(layer) {
  return {
    pillar: layer.pillar,
    occurrence: {
      occurrenceId: layer.occurrenceId,
      scope: 'time',
      location: layer.layerId,
      subjectRef: layer.subjectRef
    }
  };
}

function layerPairs(layers, includeCrossLevel) {
  const present = TIME_LAYERS.filter((layer) => Object.hasOwn(layers, layer));
  const pairs = [];
  for (let left = 0; left < present.length; left += 1) {
    for (let right = left + 1; right < present.length; right += 1) {
      if (includeCrossLevel || right === left + 1) pairs.push([present[left], present[right]]);
    }
  }
  return pairs;
}

function evaluateSegment(chart, segment, includeCrossLevel) {
  const natalRelations = [];
  for (const layer of TIME_LAYERS) {
    if (!Object.hasOwn(segment.layers, layer)) continue;
    for (const slot of PILLAR_SLOTS) {
      natalRelations.push({
        natalSlot: slot,
        timeLayer: layer,
        relation: relatePillars(natalSide(chart, slot), timeSide(layer, segment.layers[layer]))
      });
    }
  }

  const timeRelations = layerPairs(segment.layers, includeCrossLevel).map(([leftLayer, rightLayer]) => ({
    leftLayer,
    rightLayer,
    relation: relatePillars(
      timeSide(leftLayer, segment.layers[leftLayer]),
      timeSide(rightLayer, segment.layers[rightLayer])
    )
  }));
  const branchGroups = detectCompleteBranchGroups([
    ...PILLAR_SLOTS.map((slot) => ({
      occurrenceId: `natal.${slot}`,
      scope: 'natal',
      location: slot,
      subjectRef: chart.subjectRef,
      branchId: chart.pillars[slot].branchId
    })),
    ...TIME_LAYERS.filter((layer) => Object.hasOwn(segment.layers, layer)).map((layer) => ({
      occurrenceId: `time.${layer}`,
      scope: 'time',
      location: layer,
      subjectRef: null,
      branchId: segment.layers[layer].branchId
    }))
  ]).filter((group) => groupAllowedByScopeProfile(group, TEMPORAL_SCOPE_PROFILE));

  return deepFreeze({
    ...(segment.kind === 'instant'
      ? { kind: 'instant', at: segment.at }
      : { kind: 'interval', validFrom: segment.from, validUntil: segment.until }),
    layers: segment.layers,
    natalRelations,
    timeRelations,
    branchGroups,
    effectEligible: false
  });
}

export function evaluateTemporal(chartValue, queryValue, options = {}) {
  const chart = captureChartRecord(chartValue);
  const settings = captureRecord(options, 'temporal.options', [], ['maxSegments', 'includeCrossLevel', 'lifeStageRequest']);
  const query = captureResolvedTimeQuery(queryValue, { maxSegments: settings.maxSegments });
  const includeCrossLevel = settings.includeCrossLevel === true;
  const sourceSegments = query.mode === 'instant'
    ? [{ kind: 'instant', at: query.at, layers: query.layers }]
    : query.segments.map((segment) => ({ ...segment, kind: 'interval' }));
  const segments = sourceSegments.map((segment) => evaluateSegment(chart, segment, includeCrossLevel));
  let lifeStageMatchSet = null;
  if (Object.hasOwn(settings, 'lifeStageRequest')) {
    if (query.mode !== 'instant') {
      throw new TypeError('lifeStageRequest currently requires an instant query with an explicit age coordinate');
    }
    lifeStageMatchSet = matchCapturedLifeStageCandidates(chart, settings.lifeStageRequest, query.at);
  }
  const body = {
    version: 'bazi.temporal_evaluation.v1',
    subjectRef: chart.subjectRef,
    snapshotRef: chart.snapshotRef,
    validTimeRef: chart.validTimeRef,
    chartIdentityHash: chart.chartIdentityHash,
    chartProvenance: chart.provenance,
    queryMode: query.mode,
    queryProvenance: query.provenance,
    includeCrossLevel,
    segments,
    ...(lifeStageMatchSet === null ? {} : { lifeStageMatchSet }),
    profileId: RAW_RELATION_PROFILE.profileId,
    profileHash: RAW_RELATION_PROFILE.profileHash,
    scopeProfileId: TEMPORAL_SCOPE_PROFILE.profileId,
    scopeProfileHash: TEMPORAL_SCOPE_PROFILE.profileHash,
    utility: 'indeterminate',
    effectEligible: false
  };
  return deepFreeze({ ...body, evaluationId: contentHash(body) });
}

export function compileSixLayerTemporalRelations(chartValue, inputValue) {
  const chart = captureChartRecord(chartValue);
  const input = captureSixLayerTemporalInput(inputValue);
  if (input.subjectRef !== chart.subjectRef) {
    throw new TypeError('sixLayerInput.subjectRef must equal chart.subjectRef');
  }
  if (input.snapshotRef !== chart.snapshotRef) {
    throw new TypeError('sixLayerInput.snapshotRef must equal chart.snapshotRef');
  }
  const byLayer = new Map(input.layers.map((layer) => [layer.layerId, layer]));
  const natalTemporalRelations = [];
  for (const layerId of SIX_LAYER_TEMPORAL_IDS) {
    const layer = byLayer.get(layerId);
    for (const slot of PILLAR_SLOTS) {
      natalTemporalRelations.push({
        natalOccurrenceId: `natal.${slot}`,
        temporalOccurrenceId: layer.occurrenceId,
        natalSlot: slot,
        layerId,
        relation: relatePillars(natalSide(chart, slot), explicitTimeSide(layer))
      });
    }
  }
  const interLayerRelations = [];
  for (let left = 0; left < SIX_LAYER_TEMPORAL_IDS.length; left += 1) {
    for (let right = left + 1; right < SIX_LAYER_TEMPORAL_IDS.length; right += 1) {
      const leftLayer = byLayer.get(SIX_LAYER_TEMPORAL_IDS[left]);
      const rightLayer = byLayer.get(SIX_LAYER_TEMPORAL_IDS[right]);
      interLayerRelations.push({
        leftLayerId: leftLayer.layerId,
        rightLayerId: rightLayer.layerId,
        leftOccurrenceId: leftLayer.occurrenceId,
        rightOccurrenceId: rightLayer.occurrenceId,
        relation: relatePillars(explicitTimeSide(leftLayer), explicitTimeSide(rightLayer))
      });
    }
  }
  const branchGroups = detectCompleteBranchGroups([
    ...PILLAR_SLOTS.map((slot) => ({
      occurrenceId: `natal.${slot}`,
      scope: 'natal',
      location: slot,
      subjectRef: chart.subjectRef,
      branchId: chart.pillars[slot].branchId
    })),
    ...input.layers.map((layer) => ({
      occurrenceId: layer.occurrenceId,
      scope: 'time',
      location: layer.layerId,
      subjectRef: layer.subjectRef,
      branchId: layer.pillar.branchId
    }))
  ]).filter((group) => groupAllowedByScopeProfile(group, TEMPORAL_SCOPE_PROFILE));
  const body = {
    version: 'bazi.six_layer_temporal_relation_set.v1',
    subjectRef: chart.subjectRef,
    snapshotRef: chart.snapshotRef,
    validTimeRef: chart.validTimeRef,
    at: input.at,
    chartIdentityHash: chart.chartIdentityHash,
    inputHash: input.inputHash,
    chartProvenance: chart.provenance,
    inputProvenance: input.provenance,
    temporalOccurrences: input.layers,
    natalTemporalRelations,
    interLayerRelations,
    branchGroups,
    cardinality: {
      temporalOccurrences: SIX_LAYER_TEMPORAL_IDS.length,
      natalTemporalPillarPairs: natalTemporalRelations.length,
      interLayerPillarPairs: interLayerRelations.length,
      completeBranchGroups: branchGroups.length
    },
    relationClosure: {
      policy: 'all_declared_occurrence_pairs_once',
      maximumDerivedDepth: 1,
      syntheticOccurrenceCreation: false,
      candidateTransformationReentry: false
    },
    relationProfileId: RAW_RELATION_PROFILE.profileId,
    relationProfileHash: RAW_RELATION_PROFILE.profileHash,
    temporalProfileId: SIX_LAYER_TEMPORAL_PROFILE.profileId,
    temporalProfileHash: SIX_LAYER_TEMPORAL_PROFILE.profileHash,
    scopeProfileId: TEMPORAL_SCOPE_PROFILE.profileId,
    scopeProfileHash: TEMPORAL_SCOPE_PROFILE.profileHash,
    judgmentStatus: 'not_evaluated',
    causalStatus: 'not_modeled',
    utility: 'indeterminate',
    effectEligible: false
  };
  return deepFreeze({ ...body, relationSetHash: contentHash(body) });
}
