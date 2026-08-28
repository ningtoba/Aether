import { describe, it, expect } from 'vitest';
import { isValidUrl, isValidPort, isNonEmptyString, isPlainObject } from './validation.js';

describe('isValidUrl', () => {
  it('should accept https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  it('should accept http URLs', () => {
    expect(isValidUrl('http://example.com/path?q=1')).toBe(true);
  });

  it('should accept URLs with ports', () => {
    expect(isValidUrl('http://localhost:3000')).toBe(true);
  });

  it('should accept ws URLs', () => {
    expect(isValidUrl('ws://localhost:8080/ws')).toBe(true);
  });

  it('should reject random strings', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('should reject numbers passed as strings', () => {
    expect(isValidUrl('12345')).toBe(false);
  });
});

describe('isValidPort', () => {
  it('should accept port 1', () => {
    expect(isValidPort(1)).toBe(true);
  });

  it('should accept port 65535', () => {
    expect(isValidPort(65535)).toBe(true);
  });

  it('should accept port 3000', () => {
    expect(isValidPort(3000)).toBe(true);
  });

  it('should reject port 0', () => {
    expect(isValidPort(0)).toBe(false);
  });

  it('should reject port 65536', () => {
    expect(isValidPort(65536)).toBe(false);
  });

  it('should reject negative ports', () => {
    expect(isValidPort(-1)).toBe(false);
  });

  it('should reject non-integer values', () => {
    expect(isValidPort(3.14)).toBe(false);
  });
});

describe('isNonEmptyString', () => {
  it('should return true for non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('should return false for empty strings', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isNonEmptyString(42)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isNonEmptyString(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isNonEmptyString([])).toBe(false);
  });

  it('should return false for objects', () => {
    expect(isNonEmptyString({})).toBe(false);
  });
});

describe('isPlainObject', () => {
  it('should return true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ key: 'value' })).toBe(true);
  });

  it('should return false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('should return false for arrays', () => {
    expect(isPlainObject([])).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isPlainObject('hello')).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(isPlainObject(42)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isPlainObject(undefined)).toBe(false);
  });

  it('should return false for Date/Map/Set (not plain objects)', () => {
    // Only real plain objects qualify — Date/Map/Set must not, or deepMerge
    // would spread a Date into {} and silently destroy the value.
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject(new Set())).toBe(false);
  });
});
