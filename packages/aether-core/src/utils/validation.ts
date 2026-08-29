/** Validates a URL string */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Validates a TCP port number */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Type guard: checks if value is a non-empty string */
export function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0;
}

/** Type guard: checks if value is a plain object (not null, not array) */
export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return isPlainObjectValue(val);
}
function isPlainObjectValue(val: unknown): boolean {
  // Only real plain objects qualify — Date/Map/Set/Buffer/RegExp must not,
  // otherwise deepMerge would spread a Date into {} and destroy the value.
  if (typeof val !== 'object' || val === null) return false;
  if (Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}
