export function assertRecord(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

export function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function captureJsonData(value, field = 'value') {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite JSON data`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object') throw new TypeError(`${field} must be JSON data`);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new TypeError(`${field} must be a plain array`);
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(`${field}[${index}] must be an own data property`);
      }
      result.push(captureJsonData(descriptor.value, `${field}[${index}]`));
    }
    return result;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${field} must be a plain JSON object`);
  }
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${field} must use string keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${field}.${key} must be an own data property`);
    }
 const normalizedKey = key.normalize('NFC');
 if (Object.hasOwn(result, normalizedKey)) {
 throw new TypeError(`${field} has duplicate NFC key: ${normalizedKey}`);
 }
 Object.defineProperty(result, normalizedKey, {
 value: captureJsonData(descriptor.value, `${field}.${key}`),
 enumerable: true, writable: true, configurable: true,
 });
  }
  return result;
}

// Captures an external DTO without invoking getters and without retaining its
// prototype. Validation and later computation must use only the returned
// plain record, which closes validate-then-read TOCTOU gaps from accessors,
// inherited fields, symbol keys, exotic prototypes and changing Proxy get traps.
export function captureExactDataRecord(value, allowed, field) {
  assertRecord(value, field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${field} must be a plain object or a null-prototype record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  const extras = ownKeys.filter(
    (key) => typeof key !== 'string' || !allowed.includes(key),
  );
  if (extras.length) {
    throw new TypeError(`${field} has unknown fields: ${extras.map(String).join(', ')}`);
  }

  const captured = {};
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (descriptor == null) continue;
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${field}.${key} must be an own data property`);
    }
    captured[key] = descriptor.value;
  }
  return captured;
}

export function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

export function optionalString(value, field) {
  if (value == null) return null;
  return requiredString(value, field);
}

export function stringArray(value, field) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return Object.freeze(value.map((item, index) => requiredString(item, `${field}[${index}]`)));
}

export function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw new TypeError(`${field} must be one of ${allowed.join('|')}`);
  return value;
}

export function finiteNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${field} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}
