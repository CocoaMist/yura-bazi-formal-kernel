import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTimeRequest, resolveTimeRequest } from '../src/calendar.mjs';
import { instantQuery, provenance, rangeQuery } from './fixtures.mjs';

const providerSources = ['standard:gbt-33661-2017', 'tzdb:test'];

function providerProvenance(request) {
  return provenance({
    authorityId: 'calendar:test',
    authorityVersion: '1.0.0',
    sourceRefs: providerSources,
    requestHash: request.requestHash
  });
}

function provider() {
  return {
    providerId: 'calendar:test',
    version: '1.0.0',
    sourceRefs: providerSources,
    resolveInstant: async (normalized) => instantQuery({ provenance: providerProvenance(normalized) }),
    resolveRange: async (normalized) => rangeQuery({ provenance: providerProvenance(normalized) })
  };
}

function request(mode = 'instant') {
  const common = {
    version: 'bazi.time_request.v1',
    mode,
    calendar: 'gregorian',
    timeZoneId: 'Asia/Shanghai',
    location: { longitude: 116.4074, latitude: 39.9042, label: 'Beijing' },
    solarTime: { mode: 'true_solar', algorithmRef: 'meeus-profile.v1' },
    boundaryProfileId: 'yura-boundary.v1'
  };
  return mode === 'instant'
    ? { ...common, input: '2026-01-01T10:30:00+08:00' }
    : { ...common, startInput: '2026-01-01T10:00:00+08:00', endInput: '2026-01-01T12:00:00+08:00' };
}

test('calendar provider resolves one instant with declared evidence', async () => {
  const result = await resolveTimeRequest(request(), provider());
  assert.equal(result.resolved.mode, 'instant');
  assert.equal(result.provider.providerId, 'calendar:test');
  assert.deepEqual(result.provider.sourceRefs, ['standard:gbt-33661-2017', 'tzdb:test']);
  assert.equal(result.request.solarTime.mode, 'true_solar');
});

test('calendar provider resolves a range without instant fallback', async () => {
  let instantCalls = 0;
  let rangeCalls = 0;
  const implementation = provider();
  implementation.resolveInstant = async (normalized) => {
    instantCalls += 1;
    return instantQuery({ provenance: providerProvenance(normalized) });
  };
  implementation.resolveRange = async (normalized) => {
    rangeCalls += 1;
    return rangeQuery({ provenance: providerProvenance(normalized) });
  };
  const result = await resolveTimeRequest(request('range'), implementation);
  assert.equal(result.resolved.segments.length, 2);
  assert.equal(rangeCalls, 1);
  assert.equal(instantCalls, 0);
});

test('true solar time requires a location and an algorithm reference', () => {
  const missingLocation = request();
  delete missingLocation.location;
  assert.throws(() => captureTimeRequest(missingLocation), /requires timeRequest.location/);

  const missingAlgorithm = request();
  missingAlgorithm.solarTime = { mode: 'true_solar' };
  assert.throws(() => captureTimeRequest(missingAlgorithm), /algorithmRef is required/);
});

test('request binding, IANA zones and real Gregorian dates fail closed', async () => {
  const unrelated = provider();
  unrelated.resolveInstant = async () => instantQuery({
    provenance: providerProvenance({ requestHash: `sha256:${'b'.repeat(64)}` })
  });
  await assert.rejects(() => resolveTimeRequest(request(), unrelated), /not bound/);

  const invalidZone = request();
  invalidZone.timeZoneId = 'Mars/Olympus';
  assert.throws(() => captureTimeRequest(invalidZone), /valid IANA/);

  const invalidDate = instantQuery();
  invalidDate.at = '2026-02-30T02:30:00Z';
  await assert.rejects(() => resolveTimeRequest(request(), {
    ...provider(),
    resolveInstant: async () => invalidDate
  }), /real Gregorian date-time/);
});
