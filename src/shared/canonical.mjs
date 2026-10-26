import { createHash } from 'node:crypto';
import { captureJsonData } from './assert.mjs';

function encodeCaptured(value) {
if (value === null || typeof value !== 'object') return JSON.stringify(value);
if (Array.isArray(value)) return `[${value.map(encodeCaptured).join(',')}]`;
// Emit entries directly: JSON.stringify(object) reorders integer-like keys.
return `{${Object.keys(value).sort().map((key) => (
`${JSON.stringify(key)}:${encodeCaptured(value[key])}`
)).join(',')}}`;
}

export function canonicalJsonV1(value) {
return encodeCaptured(captureJsonData(value, 'canonical JSON'));
}

export function contentHashV1(value) {
  return `sha256:${createHash('sha256').update(canonicalJsonV1(value)).digest('hex')}`;
}

export function domainHashV1(domainTag, value) {
  if (typeof domainTag !== 'string' || domainTag.length === 0 || domainTag !== domainTag.normalize('NFC')) {
    throw new TypeError('domainTag must be a non-empty NFC string');
  }
  return `sha256:${createHash('sha256')
    .update(`yura.formal.hash.v1\0${domainTag}\0`, 'utf8')
    .update(canonicalJsonV1(value), 'utf8')
    .digest('hex')}`;
}

// Locale-independent ordering. String.prototype.localeCompare depends on the
// ICU build and the ambient locale, so it must never decide canonical order.
export function compareCanonical(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// Canonical JSON is the preferred external transport: bytes or text are parsed
// here, and only the parsed plain value continues into validation.
export function parseCanonicalJsonV1(source, field) {
  let text;
  if (typeof source === 'string') text = source;
  else if (source instanceof Uint8Array) text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  else throw new TypeError(`${field} must be canonical JSON text or UTF-8 bytes`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(`${field} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${field} must decode to a JSON object`);
  }
  return parsed;
}
