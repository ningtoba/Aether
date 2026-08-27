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
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
