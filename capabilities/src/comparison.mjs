import { captureChartRecord } from './contracts.mjs';
import { PILLAR_SLOTS, RAW_RELATION_PROFILE } from './profile.mjs';
import { detectCompleteBranchGroups, relatePillars } from './relations.mjs';
import { COMPARISON_SCOPE_PROFILE, groupAllowedByScopeProfile } from './scope-profile.mjs';
import { captureRecord, contentHash, deepFreeze, fail } from './shared.mjs';

function chartSide(chart, side, slot) {
  return {
    pillar: chart.pillars[slot],
    occurrence: {
      occurrenceId: `${side}.${slot}`,
      scope: side,
      location: slot,
      subjectRef: chart.subjectRef
    }
  };
}

function branchOccurrences(chart, side) {
  return PILLAR_SLOTS.map((slot) => ({
    occurrenceId: `${side}.${slot}`,
    scope: side,
    location: slot,
    subjectRef: chart.subjectRef,
    branchId: chart.pillars[slot].branchId
  }));
}

export function compareCharts(leftValue, rightValue, options = {}) {
  const left = captureChartRecord(leftValue);
  const right = captureChartRecord(rightValue);
  const settings = captureRecord(options, 'comparison.options', [], ['mode']);
  const mode = settings.mode ?? 'synastry';
  if (!['synastry', 'variant'].includes(mode)) fail('comparison mode must be synastry or variant');
  if (left.subjectRef === right.subjectRef && left.snapshotRef === right.snapshotRef) {
    fail('comparison requires two distinct subject-scoped snapshots');
  }
  if (mode === 'synastry' && left.subjectRef === right.subjectRef) {
    fail('synastry requires distinct subjects; use variant for one subject');
  }

  const pairs = [];
  for (const leftSlot of PILLAR_SLOTS) {
    for (const rightSlot of PILLAR_SLOTS) {
      pairs.push({
        leftSlot,
        rightSlot,
        relation: relatePillars(chartSide(left, 'left', leftSlot), chartSide(right, 'right', rightSlot))
      });
    }
  }
  const branchGroups = detectCompleteBranchGroups([
    ...branchOccurrences(left, 'left'),
    ...branchOccurrences(right, 'right')
  ]).filter((group) => groupAllowedByScopeProfile(group, COMPARISON_SCOPE_PROFILE));

  const body = {
    version: 'bazi.chart_comparison.v1',
    mode,
    left: {
      subjectRef: left.subjectRef,
      snapshotRef: left.snapshotRef,
      validTimeRef: left.validTimeRef,
      chartContentHash: left.chartContentHash,
      chartIdentityHash: left.chartIdentityHash,
      provenance: left.provenance
    },
    right: {
      subjectRef: right.subjectRef,
      snapshotRef: right.snapshotRef,
      validTimeRef: right.validTimeRef,
      chartContentHash: right.chartContentHash,
      chartIdentityHash: right.chartIdentityHash,
      provenance: right.provenance
    },
    sameChartContent: left.chartContentHash === right.chartContentHash,
    pairs,
    branchGroups,
    profileId: RAW_RELATION_PROFILE.profileId,
    profileHash: RAW_RELATION_PROFILE.profileHash,
    scopeProfileId: COMPARISON_SCOPE_PROFILE.profileId,
    scopeProfileHash: COMPARISON_SCOPE_PROFILE.profileHash,
    utility: 'indeterminate',
    effectEligible: false
  };
  return deepFreeze({ ...body, comparisonId: contentHash(body) });
}
