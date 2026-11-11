/**
 * Launch-identity encoding for opaque `browser.providerOptions.launch` values.
 *
 * `providerOptions` is opaque third-party data (Playwright options), so it may
 * hold functions, class instances (e.g. a `logger`) and cycles. `JSON.stringify`
 * throws on cycles and silently drops functions, so the key is built
 * structurally instead: plain objects/arrays/primitives compare by value, and
 * any other value compares by reference identity.
 */
const identityIds = new WeakMap<object, number>();
let nextIdentityId = 0;

// Symbols cannot always be WeakMap keys (`Symbol.for()` registered ones throw),
// so they get their own Map; the set of distinct symbols in launch options is
// tiny, so the strong reference is harmless.
const symbolIds = new Map<symbol, number>();

const identityOf = (value: object): number => {
  let id = identityIds.get(value);
  if (id === undefined) {
    id = nextIdentityId++;
    identityIds.set(value, id);
  }
  return id;
};

const symbolIdentityOf = (value: symbol): number => {
  let id = symbolIds.get(value);
  if (id === undefined) {
    id = nextIdentityId++;
    symbolIds.set(value, id);
  }
  return id;
};

const isPlainRecord = (value: object): value is Record<string, unknown> => {
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
};

const encode = (value: unknown, ancestors: object[]): string => {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'undefined':
      return 'undefined';
    case 'bigint':
      return `${value}n`;
    case 'function':
      return `#ref${identityOf(value)}`;
    case 'symbol':
      return `#sym${symbolIdentityOf(value)}`;
  }
  if (value === null) {
    return 'null';
  }
  const object = value as object;
  const cycleIndex = ancestors.indexOf(object);
  if (cycleIndex !== -1) {
    // Position in the current path keeps the key deterministic across
    // equal-shaped cyclic structures.
    return `#cycle${cycleIndex}`;
  }
  const isArray = Array.isArray(object);
  if (!isArray && !isPlainRecord(object)) {
    return `#ref${identityOf(object)}`;
  }
  const path = [...ancestors, object];
  if (isArray) {
    return `[${(object as unknown[]).map((item) => encode(item, path)).join(',')}]`;
  }
  const record = object as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${encode(record[key], path)}`);
  return `{${entries.join(',')}}`;
};

export const encodeOpaqueValue = (value: unknown): string => encode(value, []);
