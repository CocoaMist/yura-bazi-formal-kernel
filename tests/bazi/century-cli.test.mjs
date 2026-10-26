import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_CALENDAR_PROFILE } from '../../capabilities/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const natalFixedBundle = JSON.parse(readFileSync(
  new URL('../../examples/2000-07-19-beijing-male.output.json', import.meta.url),
  'utf8',
));

function segment(segmentId, stemId, branchId) {
  return {
    segmentId,
    pillar: { stemId, branchId },
    validFrom: '1999-01-01T00:00:00Z',
    validUntil: '2101-01-01T00:00:00Z',
    termRef: `term:${segmentId}`,
    sourceRefs: [`test:${segmentId}:explicit-placeholder-not-authority`],
    authorityRef: 'test:explicit-placeholder-not-authority',
    calculationProfileRef: 'test:explicit-placeholder-not-authority.v1',
    calendarBasisRef: 'calendar:explicit-test-schedule',
    boundaryProfileRef: 'boundary:explicit-test-schedule.v1',
    locationTimeRef: 'timezone:Asia/Shanghai',
    inputDependencyRefs: ['test:century-cli'],
    decisionRefs: ['test:century-cli:explicit-placeholder'],
  };
}

test('century CLI emits one compact machine-readable bundle for all 101 age coordinates', () => {
  const request = {
    version: 'yuracore.century_temporal_compile_request.v1',
    natalFixedBundle,
    releaseManifestPath: 'release-manifest.json',
    centuryPlan: {
      version: 'bazi.century_temporal_plan.v1',
      subjectRef: natalFixedBundle.subjectContext.subjectRef,
      snapshotRef: 'natal-fixed-bundle:self',
      birthLocal: '2000-07-19T16:00:00.000',
      ageFrom: 0,
      ageThrough: 100,
      anniversaryProfileId: 'bazi.age_sampling.gregorian_local_anniversary_feb28.v1',
      calendarContext: {
        timeZoneId: 'Asia/Shanghai',
        location: { longitude: 116.4074, latitude: 39.9042, label: 'Beijing' },
        solarTime: { mode: 'civil' },
        boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
      },
      majorLuckSchedule: [segment('major:explicit-test', 'jia', 'zi')],
      minorLuckSchedule: [segment('minor:explicit-test', 'yi', 'chou')],
      provenance: { scope: 'test_only_explicit_placeholder_not_authority' },
    },
  };
  const run = spawnSync(process.execPath, ['tools/compile-century.mjs'], {
    cwd: root,
    input: JSON.stringify(request),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.version, 'yuracore.century_temporal_bundle.v1');
  assert.equal(output.ageFrom, 0);
  assert.equal(output.ageThrough, 100);
  assert.equal(output.ageCount, 101);
  assert.equal(output.generation.ageResultCount, 101);
  assert.equal(output.temporalKernelBatch.inputCount, 101);
  assert.equal(output.temporalKernelBatch.resultCount, 101);
  assert.equal(output.ageIndex.length, 101);
  assert.ok(output.ageIndex.every((row) => row.temporalCompilationStatus === 'compiled'));
  assert.equal(output.judgmentStatus, 'not_evaluated');
  assert.equal(output.causalStatus, 'not_modeled');
  assert.equal(output.effectEligible, false);
  assert.match(output.centuryTemporalBundleHash, /^sha256:[0-9a-f]{64}$/);
});
