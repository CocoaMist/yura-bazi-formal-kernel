import { PILLAR_SLOTS } from './constants.mjs';
import { captureValidatedPillars } from './encoding.mjs';
import {
  captureExactDataRecord,
  optionalString,
  requiredString,
} from '../shared/assert.mjs';
import { contentHashV1, parseCanonicalJsonV1 } from '../shared/canonical.mjs';

export const BAZI_CHART_SNAPSHOT_VERSION = 'bazi.chart_snapshot.v2';
export const BAZI_CHART_SNAPSHOT_LEGACY_VERSION = 'bazi.chart_snapshot.v1';
export const TRADITIONAL_SEX_CLASSES = Object.freeze(['male', 'female', 'unknown']);

function coordinateIdentity(snapshot) {
  return {
    version: 'bazi.coordinate_content.v1',
    pillars: Object.fromEntries(PILLAR_SLOTS.map((slot) => [slot, {
      stemId: snapshot.pillars[slot].stemId,
      branchId: snapshot.pillars[slot].branchId,
    }])),
  };
}

function legacyChartIdentity(snapshot) {
  return {
    version: BAZI_CHART_SNAPSHOT_LEGACY_VERSION,
    subjectRef: snapshot.subjectRef,
    validTimeRef: snapshot.validTimeRef,
    pillars: Object.fromEntries(PILLAR_SLOTS.map((slot) => [slot, {
      stemId: snapshot.pillars[slot].stemId,
      branchId: snapshot.pillars[slot].branchId,
    }])),
  };
}

function inputIdentity(snapshot) {
  return {
    version: BAZI_CHART_SNAPSHOT_VERSION,
    snapshotId: snapshot.snapshotId,
    subjectRef: snapshot.subjectRef,
    validTimeRef: snapshot.validTimeRef,
    traditionalSexClass: snapshot.traditionalSexClass,
    pillars: coordinateIdentity(snapshot).pillars,
    provenanceRef: snapshot.provenanceRef,
  };
}

function captureBaziChartSnapshot(snapshot) {
  const source = captureExactDataRecord(
    snapshot,
    [
      'version', 'snapshotId', 'snapshotHash', 'inputSnapshotHash',
      'structuralContentHash', 'coordinateContentHash', 'subjectRef', 'validTimeRef',
      'traditionalSexClass', 'pillars', 'provenanceRef',
    ],
    'BaziChartSnapshotV1',
  );
  if (![BAZI_CHART_SNAPSHOT_LEGACY_VERSION, BAZI_CHART_SNAPSHOT_VERSION].includes(source.version)) {
    throw new TypeError(`BaziChartSnapshot.version must be ${BAZI_CHART_SNAPSHOT_LEGACY_VERSION} or ${BAZI_CHART_SNAPSHOT_VERSION}`);
  }
  const captured = {
    version: source.version,
    snapshotId: requiredString(source.snapshotId, 'BaziChartSnapshot.snapshotId'),
    subjectRef: requiredString(source.subjectRef, 'BaziChartSnapshot.subjectRef'),
    validTimeRef: requiredString(source.validTimeRef, 'BaziChartSnapshot.validTimeRef'),
    pillars: captureValidatedPillars(source.pillars),
    provenanceRef: optionalString(source.provenanceRef, 'BaziChartSnapshot.provenanceRef'),
  };
  if (captured.version === BAZI_CHART_SNAPSHOT_VERSION) {
    if (!TRADITIONAL_SEX_CLASSES.includes(source.traditionalSexClass)) {
      throw new TypeError('BaziChartSnapshotV2.traditionalSexClass must be male, female or unknown');
    }
    captured.traditionalSexClass = source.traditionalSexClass;
  }
  const coordinateContentHash = contentHashV1(coordinateIdentity(captured));
  const legacyStructuralProjectionHash = contentHashV1({
    version: 'bazi.structural_content.v1',
    pillars: coordinateIdentity(captured).pillars,
  });
  const inputSnapshotHash = captured.version === BAZI_CHART_SNAPSHOT_VERSION
    ? contentHashV1(inputIdentity(captured))
    : contentHashV1(legacyChartIdentity(captured));
  for (const [field, expected] of [
    ['snapshotHash', inputSnapshotHash],
    ['inputSnapshotHash', inputSnapshotHash],
    ['coordinateContentHash', coordinateContentHash],
  ]) {
    if (source[field] != null && source[field] !== expected) {
      throw new TypeError(`BaziChartSnapshot.${field} does not match captured content`);
    }
  }
  // v0.4.0 exposed a coordinate-only value under the misleading
  // structuralContentHash name. It remains readable but is no longer emitted.
  if (source.structuralContentHash != null
    && source.structuralContentHash !== legacyStructuralProjectionHash) {
    throw new TypeError('BaziChartSnapshot.structuralContentHash does not match legacy captured content');
  }
  return Object.freeze({
    version: captured.version,
    snapshotId: captured.snapshotId,
    snapshotHash: inputSnapshotHash,
    inputSnapshotHash,
    coordinateContentHash,
    subjectRef: captured.subjectRef,
    validTimeRef: captured.validTimeRef,
    ...(captured.version === BAZI_CHART_SNAPSHOT_VERSION
      ? { traditionalSexClass: captured.traditionalSexClass }
      : {}),
    pillars: captured.pillars,
    provenanceRef: captured.provenanceRef,
  });
}

// A predicate, never a source of records. Returning the caller's object here
// would hand back the mutable input the capture boundary exists to exclude.
export function assertBaziChartSnapshot(snapshot) {
  captureBaziChartSnapshot(snapshot);
  return true;
}

export function freezeBaziChartSnapshot(snapshot) {
  return captureBaziChartSnapshot(snapshot);
}

// Preferred external transport: canonical JSON text or UTF-8 bytes never carry
// accessors, prototypes or Proxy traps into the deterministic kernel.
export function freezeBaziChartSnapshotFromCanonicalJson(source) {
  return captureBaziChartSnapshot(
    parseCanonicalJsonV1(source, 'BaziChartSnapshotV1'),
  );
}
