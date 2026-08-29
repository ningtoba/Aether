/** Deeply merges a source object into a target without mutating either */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    // Never let untrusted source keys (e.g. parsed JSON `__proto__`) rewrite
    // the result's prototype — the merged data would silently vanish from
    // Object.keys/JSON/structuredClone while polluting property lookups.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const srcVal = source[key];
    const tgtVal = target[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}

/** Deep clones a value using structuredClone */
export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

/** Picks specified keys from an object */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    // Own properties only: `in` would copy inherited keys, and writing an own
    // "__proto__" key via assignment would mutate the result's prototype.
    if (key === '__proto__') continue;
    if (Object.prototype.hasOwnProperty.call(obj, key)) result[key] = obj[key];
  }
  return result;
}

/** Omits specified keys from an object */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) delete result[key];
  return result;
}

/** Deep structural equality, independent of key insertion order */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  // NaN: keep the documented NaN-equals-NaN behavior (Object.is semantics).
  if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b as number)) return true;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], (b as unknown[])[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;

  // Deep compare objects independently of key insertion order, and treat an
  // own key present with `undefined` as distinct from an absent key (which
  // JSON.stringify would collapse).
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!isEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  // Only real plain objects qualify; Date/Map/Set must not be treated as
  // mergeable (spreading a Date into {} would destroy the value).
  if (typeof val !== 'object' || val === null) return false;
  if (Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}
