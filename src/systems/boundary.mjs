import {
  requiredString,
} from '../shared/assert.mjs';

export const BAZI_FOUNDATION_LANE_ID = 'bazi.foundation.v1';

export function namespaceOf(identifier) {
  const value = requiredString(identifier, 'identifier');
  const separator = value.indexOf('.');
  if (separator <= 0) throw new TypeError('identifier must be namespaced');
  return value.slice(0, separator);
}

export function assertLaneMayMutate(laneId, targetMetric) {
  const normalizedLaneId = requiredString(laneId, 'laneId');
  const namespace = namespaceOf(targetMetric);
  if (normalizedLaneId !== BAZI_FOUNDATION_LANE_ID || namespace !== 'bazi') {
    throw new Error(`lane ${normalizedLaneId} may not mutate namespace ${namespace}`);
  }
  return true;
}
