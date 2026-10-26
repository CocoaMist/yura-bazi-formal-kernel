import { readFile } from 'node:fs/promises';
import {
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER,
  buildNatalCalendarArtifacts,
  resolveTimeRequest,
} from '../capabilities/src/index.mjs';
import {
  admitReleaseManifestV2,
  buildNatalFixedBundleV1,
  buildNatalCompilationRequestV1,
  canonicalJsonV1,
  compileNatalRequest,
  domainHashV1,
  resolveSelectedRelationProfile,
} from '../src/index.mjs';

const INPUT_VERSION = 'yuracore.birth_compilation_input.v1';
const LEGACY_BUNDLE_VERSION = 'yuracore.birth_compilation_bundle.v1';
const ERROR_VERSION = 'yuracore.birth_compilation_error.v1';
const POLICY_ORDER = Object.freeze(['civil', 'true_solar']);

function fail(message) {
  throw new TypeError(message);
}

function exactRecord(value, field, required) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(value, key))) {
    fail(`${field} fields must be exactly: ${required.join(', ')}`);
  }
  return value;
}

function string(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail(`${field} must be a non-empty string`);
  return value.normalize('NFC');
}

function captureInput(value) {
  const source = exactRecord(value, 'input', [
    'version', 'subjectRef', 'birth', 'clockPolicies', 'precisionPolicy', 'activeProfileId',
  ]);
  if (source.version !== INPUT_VERSION) fail(`input.version must be ${INPUT_VERSION}`);
  const birth = exactRecord(source.birth, 'input.birth', [
    'calendar', 'timeZoneId', 'input', 'location', 'traditionalSexClass',
  ]);
  if (!['gregorian', 'lunar'].includes(birth.calendar)) fail('input.birth.calendar is unsupported');
  if (!['male', 'female', 'unknown'].includes(birth.traditionalSexClass)) {
    fail('input.birth.traditionalSexClass is unsupported');
  }
  const location = exactRecord(birth.location, 'input.birth.location', [
    'longitude', 'latitude', 'label',
  ]);
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180
    || !Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
    fail('input.birth.location coordinates are out of range');
  }
  if (source.precisionPolicy == null || typeof source.precisionPolicy !== 'object'
    || Array.isArray(source.precisionPolicy)) fail('input.precisionPolicy must be an object');
  if (!Array.isArray(source.clockPolicies) || source.clockPolicies.length === 0
    || new Set(source.clockPolicies).size !== source.clockPolicies.length
    || source.clockPolicies.some((policy) => !POLICY_ORDER.includes(policy))) {
    fail('input.clockPolicies must be a unique non-empty subset of civil and true_solar');
  }
  return JSON.parse(canonicalJsonV1({
    version: INPUT_VERSION,
    subjectRef: string(source.subjectRef, 'input.subjectRef'),
    birth: {
      calendar: birth.calendar,
      timeZoneId: string(birth.timeZoneId, 'input.birth.timeZoneId'),
      input: birth.input,
      location: {
        longitude: location.longitude,
        latitude: location.latitude,
        label: string(location.label, 'input.birth.location.label'),
      },
      traditionalSexClass: birth.traditionalSexClass,
    },
    clockPolicies: POLICY_ORDER.filter((policy) => source.clockPolicies.includes(policy)),
    precisionPolicy: source.precisionPolicy,
    activeProfileId: string(source.activeProfileId, 'input.activeProfileId'),
  }));
}

function timeRequest(input, clockPolicy) {
  return {
    version: 'bazi.time_request.v1',
    mode: 'instant',
    calendar: input.birth.calendar,
    timeZoneId: input.birth.timeZoneId,
    location: input.birth.location,
    solarTime: clockPolicy === 'civil'
      ? { mode: 'civil' }
      : {
        mode: 'true_solar',
        algorithmRef: REFERENCE_CALENDAR_PROFILE.trueSolarAlgorithmId,
      },
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    input: input.birth.input,
  };
}

async function compile(inputValue, legacyMode = false) {
  const input = captureInput(inputValue);
  const inputFactHash = domainHashV1('bazi.birth_input_fact.v1', input.birth);
  const resolutions = [];
  for (const policy of input.clockPolicies) {
    resolutions.push(await resolveTimeRequest(
      timeRequest(input, policy),
      REFERENCE_CALENDAR_PROVIDER,
    ));
  }
  const calendar = buildNatalCalendarArtifacts({
    version: 'bazi.natal_calendar_artifacts_request.v1',
    inputFactHash,
    subjectRef: input.subjectRef,
    validTimeRef: `birth-input:${inputFactHash}`,
    traditionalSexClass: input.birth.traditionalSexClass,
    precisionPolicy: input.precisionPolicy,
    resolutions,
  });
  const releaseContext = admitReleaseManifestV2(await readFile(
    new URL('../release-manifest.json', import.meta.url),
    'utf8',
  ));
  const request = buildNatalCompilationRequestV1({
    version: 'bazi.natal_compilation_request.v1',
    requestSchemaVersion: 'bazi.natal_compilation_request.schema.v1',
    candidateSnapshotSetHash: calendar.candidateSnapshotSet.candidateSnapshotSetHash,
    calendarDecisionTraceHash: calendar.calendarDecisionTrace.calendarDecisionTraceHash,
    releaseManifestHash: releaseContext.releaseManifestHash,
    activeProfileId: input.activeProfileId,
  });
  const batch = compileNatalRequest(
    request,
    calendar.candidateSnapshotSet,
    calendar.calendarDecisionTrace,
    releaseContext,
  );
  const selectedRelationProfile = resolveSelectedRelationProfile(
    releaseContext,
    input.activeProfileId,
  );
  if (!legacyMode) {
    return buildNatalFixedBundleV1({
      input,
      calendarArtifacts: calendar,
      calendarResolutions: resolutions,
      compilationRequest: request,
      compilationBatch: batch,
      releaseContext,
      selectedRelationProfile,
    });
  }
  const body = {
    version: LEGACY_BUNDLE_VERSION,
    input,
    inputFactHash,
    release: {
      releaseManifestHash: releaseContext.releaseManifestHash,
      engineVersion: releaseContext.engine.version,
      activeProfileId: input.activeProfileId,
    },
    calendar: {
      resolutionEnvelope: calendar.calendarResolutionEnvelope,
      decisionTrace: calendar.calendarDecisionTrace,
      candidateSnapshotSet: calendar.candidateSnapshotSet,
    },
    compilation: { request, batch },
  };
  return { ...body, bundleHash: domainHashV1('yuracore.birth_compilation_bundle.v1', body) };
}

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const source = Buffer.concat(chunks).toString('utf8');
  const input = JSON.parse(source);
  const argumentsSet = new Set(process.argv.slice(2));
  if ([...argumentsSet].some((argument) => argument !== '--legacy-bundle-v1')) {
    throw new TypeError('only --legacy-bundle-v1 is supported');
  }
  process.stdout.write(`${canonicalJsonV1(await compile(
    input,
    argumentsSet.has('--legacy-bundle-v1'),
  ))}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown internal error';
  process.stderr.write(`${canonicalJsonV1({
    version: ERROR_VERSION,
    status: 'failed',
    errorCode: error instanceof SyntaxError
      ? 'invalid_json'
      : error instanceof TypeError || error instanceof RangeError
        ? 'invalid_input_or_domain_failure'
        : 'internal_error',
    message,
  })}\n`);
  process.exitCode = 1;
}
