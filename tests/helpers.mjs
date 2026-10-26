import {
  BAZI_FOUNDATION_LANE_ID,
  admitReleaseManifestV1,
  buildBranchKey,
  buildMetricInstanceKey,
  canonicalJsonV1,
} from '../src/index.mjs';
import { readFileSync } from 'node:fs';

export const SAMPLE_SNAPSHOT = Object.freeze({
  version: 'bazi.chart_snapshot.v1',
  snapshotId: 'snapshot:test:1',
  subjectRef: 'subject:test:1',
  validTimeRef: 'time:test:natal',
  provenanceRef: 'source:snapshot:test:1',
  pillars: Object.freeze({
    year: Object.freeze({ stemId: 'jia', branchId: 'zi' }),
    month: Object.freeze({ stemId: 'bing', branchId: 'yin' }),
    day: Object.freeze({ stemId: 'jia', branchId: 'zi' }),
    hour: Object.freeze({ stemId: 'jia', branchId: 'zi' }),
  }),
});

// geng-shen / wu-zi / jia-zi / wu-chen. Branches shen, zi, zi, chen complete the
// shen-zi-chen three-harmony group, and the repeated zi forces two
// occurrence-aware hyperedge witnesses instead of one collapsed group.
export const HYPEREDGE_PILLARS = Object.freeze({
  year: Object.freeze({ stemId: 'geng', branchId: 'shen' }),
  month: Object.freeze({ stemId: 'wu', branchId: 'zi' }),
  day: Object.freeze({ stemId: 'jia', branchId: 'zi' }),
  hour: Object.freeze({ stemId: 'wu', branchId: 'chen' }),
});

const BASE_BRANCH = Object.freeze({
  system: 'bazi',
  laneId: BAZI_FOUNDATION_LANE_ID,
  ruleProfileId: 'bazi.school.none.v1',
  methodId: 'bazi.method.none.v1',
  evidencePolicyId: 'bazi.evidence.none.v1',
  resolverPolicyId: 'bazi.resolver.canonical.v3',
});

export function branchKey(overrides = {}) {
  return buildBranchKey({ ...BASE_BRANCH, ...overrides });
}

export const BRANCH_KEY = branchKey();

export const RUN_REF = 'run:test:1';

export const RELEASE_CONTEXT = admitReleaseManifestV1(
  readFileSync(new URL('../release-manifest.json', import.meta.url), 'utf8'),
);

export const ARTIFACT_CONTEXT_JSON = canonicalJsonV1({
  version: 'bazi.candidate_artifact_context.v1',
  candidateId: 'candidate:test:1',
  calendarDecisionTrace: {
    version: 'bazi.calendar_decision_trace.v1',
    requestHash: 'sha256:test-calendar-request',
    decisions: { source: 'test_fixture' },
  },
});

export const STATE_SCOPE = Object.freeze({
  branchKey: BRANCH_KEY,
  runRef: RUN_REF,
});

export function targetKey(overrides = {}) {
  return buildMetricInstanceKey({
    metricId: 'bazi.test.pressure',
    ...STATE_SCOPE,
    subjectRef: 'subject:test:1',
    validTimeRef: 'time:test:natal',
    ...overrides,
  });
}
