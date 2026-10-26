import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeRequest } from '../src/calendar.mjs';
import {
  REFERENCE_CALENDAR_PROFILE,
  REFERENCE_CALENDAR_PROVIDER
} from '../src/reference-provider.mjs';

function request(input, calendar = 'gregorian') {
  return {
    version: 'bazi.time_request.v1',
    mode: 'instant',
    calendar,
    timeZoneId: 'Asia/Shanghai',
    solarTime: { mode: 'civil' },
    boundaryProfileId: REFERENCE_CALENDAR_PROFILE.boundaryProfileId,
    input
  };
}

test('reference provider resolves Gregorian and lunar forms to one instant', async () => {
  const gregorian = await resolveTimeRequest(request({ local: '2026-02-17T10:30:00' }), REFERENCE_CALENDAR_PROVIDER);
  const lunar = await resolveTimeRequest(request({
    year: 2026,
    month: 1,
    day: 1,
    isLeapMonth: false,
    time: '10:30:00'
  }, 'lunar'), REFERENCE_CALENDAR_PROVIDER);
  assert.equal(gregorian.resolved.at, '2026-02-17T02:30:00.000Z');
  assert.equal(lunar.resolved.at, gregorian.resolved.at);
  assert.deepEqual(lunar.resolved.layers, gregorian.resolved.layers);
  assert.deepEqual(gregorian.resolved.layers, {
    year: { stemId: 'bing', branchId: 'wu' },
    month: { stemId: 'geng', branchId: 'yin' },
    day: { stemId: 'ren', branchId: 'xu' },
    hour: { stemId: 'yi', branchId: 'si' }
  });
  assert.equal(gregorian.provider.providerId, 'bazi.reference_calendar.intl_meeus');
});

test('reference provider segments a range without sampling an instant API', async () => {
  const value = request(null);
  value.mode = 'range';
  delete value.input;
  value.startInput = { local: '2026-01-01T00:30:00' };
  value.endInput = { local: '2026-01-01T04:30:00' };
  const result = await resolveTimeRequest(value, REFERENCE_CALENDAR_PROVIDER);
  assert.equal(result.resolved.start, '2025-12-31T16:30:00.000Z');
  assert.equal(result.resolved.end, '2025-12-31T20:30:00.000Z');
  assert.ok(result.resolved.segments.length >= 2);
  for (let index = 1; index < result.resolved.segments.length; index += 1) {
    assert.equal(result.resolved.segments[index - 1].until, result.resolved.segments[index].from);
  }
});

test('reference provider rejects nonexistent lunar dates and unsupported profiles', async () => {
  await assert.rejects(() => resolveTimeRequest(request({
    year: 2026,
    month: 2,
    day: 30,
    isLeapMonth: false,
    time: '10:30:00'
  }, 'lunar'), REFERENCE_CALENDAR_PROVIDER), /not a valid Chinese lunar date/);

  const unsupported = request({ local: '2026-02-17T10:30:00' });
  unsupported.boundaryProfileId = 'unknown.v1';
  await assert.rejects(() => resolveTimeRequest(unsupported, REFERENCE_CALENDAR_PROVIDER), /reference provider requires/);
});
