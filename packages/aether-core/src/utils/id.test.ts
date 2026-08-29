import { describe, it, expect } from 'vitest';
import { generateId, generateShortId, isValidId } from './id.js';

describe('generateId', () => {
  it('should generate a string with the default prefix', () => {
    const id = generateId();
    expect(id).toMatch(/^aether_[a-f0-9]{16}$/);
  });

  it('should use a custom prefix', () => {
    const id = generateId('custom');
    expect(id).toMatch(/^custom_[a-f0-9]{16}$/);
  });

  it('should generate unique IDs on successive calls', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should use empty string prefix', () => {
    const id = generateId('');
    expect(id).toMatch(/^_[a-f0-9]{16}$/);
  });
});

describe('generateShortId', () => {
  it('should generate an 8-character hex string', () => {
    const id = generateShortId();
    expect(id).toMatch(/^[a-f0-9]{8}$/);
    expect(id.length).toBe(8);
  });

  it('should generate unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()));
    expect(ids.size).toBe(100);
  });
});

describe('isValidId', () => {
  it('should validate a valid generated ID', () => {
    const id = generateId('test');
    expect(isValidId(id)).toBe(true);
  });

  it('should reject an ID without a prefix', () => {
    expect(isValidId('abcdef1234567890')).toBe(false);
  });

  it('should reject an ID with invalid characters', () => {
    expect(isValidId('test_XYZ1234567890')).toBe(false);
  });

  it('should reject a short ID (no underscore separator)', () => {
    expect(isValidId('abcdefgh')).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('should accept IDs with longer hex segment', () => {
    const longHex = 'a_' + 'a'.repeat(32);
    expect(isValidId(longHex)).toBe(true);
  });
});
