import { createHash } from 'node:crypto';

export function fail(message) {
  throw new TypeError(message);
}

export function captureRecord(value, label, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) fail(`${label} must use string keys`);
  for (const key of keys) {
    if (!allowed.has(key)) fail(`${label}.${key} is not allowed`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label}.${key} must be own data`);
  }
  for (const key of required) {
    if (!keys.includes(key)) fail(`${label}.${key} is required`);
  }
  return Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key).value]));
}

export function captureJson(value, label = 'value') {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be finite`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be a plain array`);
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label}[${index}] must be own data`);
      output.push(captureJson(descriptor.value, `${label}[${index}]`));
    }
    return output;
  }
  if (typeof value !== 'object') fail(`${label} must be JSON data`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(`${label} must use string keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label}.${key} must be own data`);
    output[key] = captureJson(descriptor.value, `${label}.${key}`);
  }
  return output;
}

export function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
  return value;
}

export function instantMs(value, label) {
  assertNonEmptyString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) fail(`${label} must be a complete ISO 8601 instant with an explicit UTC offset`);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0);
  const offset = match[8].toUpperCase() === 'Z'
    ? 0
    : (match[8][0] === '-' ? -1 : 1) * (Number(match[8].slice(1, 3)) * 60 + Number(match[8].slice(4, 6)));
  if (Math.abs(offset) > 14 * 60 || Number(match[8]?.slice(4, 6) ?? 0) > 59) {
    fail(`${label} has an invalid UTC offset`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail(`${label} must be an ISO 8601 instant`);
  const local = new Date(milliseconds + offset * 60_000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() + 1 !== month || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute
    || local.getUTCSeconds() !== second || local.getUTCMilliseconds() !== millisecond) {
    fail(`${label} must be a real Gregorian date-time`);
  }
  return milliseconds;
}

export function canonicalInstant(value, label) {
  return new Date(instantMs(value, label)).toISOString();
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value) {
  return `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;
}

export function domainHash(domainTag, value) {
  if (typeof domainTag !== 'string' || domainTag.length === 0 || domainTag !== domainTag.normalize('NFC')) {
    fail('domainTag must be a non-empty NFC string');
  }
  return `sha256:${createHash('sha256')
    .update(`yura.formal.hash.v1\0${domainTag}\0`, 'utf8')
    .update(canonicalize(value), 'utf8')
    .digest('hex')}`;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
