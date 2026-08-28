import { describe, it, expect } from 'vitest';
import { deepMerge, deepClone, pick, omit, isEqual } from './object.js';

describe('deepMerge', () => {
  it('should merge two flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 } as Record<string, unknown>, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should deeply merge nested objects', () => {
    const result = deepMerge<Record<string, unknown>>(
      { a: { b: 1, c: 2 }, d: 3 },
      { a: { b: 10 } },
    );
    expect(result).toEqual({ a: { b: 10, c: 2 }, d: 3 });
  });

  it('should not mutate the original objects', () => {
    const target = { a: { b: 1 } };
    const source = { a: { c: 2 } };
    const result = deepMerge(target as Record<string, unknown>, source);
    expect(result).toEqual({ a: { b: 1, c: 2 } });
    expect(target).toEqual({ a: { b: 1 } });
    expect(source).toEqual({ a: { c: 2 } });
  });

  it('should overwrite when source value is not a plain object', () => {
    const result = deepMerge<Record<string, unknown>>(
      { a: { b: 1 }, c: 'string' },
      { a: 'overwritten' },
    );
    expect(result).toEqual({ a: 'overwritten', c: 'string' });
  });

  it('should skip undefined values in source', () => {
    const result = deepMerge({ a: 1, b: 2 } as Record<string, unknown>, { a: undefined, c: 3 });
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });
});

describe('deepClone', () => {
  it('should deep clone a plain object', () => {
    const obj = { a: 1, b: { c: 2 } };
    const clone = deepClone(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.b).not.toBe(obj.b);
  });

  it('should clone arrays', () => {
    const arr = [1, [2, 3]];
    const clone = deepClone(arr);
    expect(clone).toEqual(arr);
    expect(clone).not.toBe(arr);
    expect(clone[1]).not.toBe(arr[1]);
  });

  it('should clone primitives', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBe(null);
    expect(deepClone(true)).toBe(true);
  });

  it('should clone Date objects', () => {
    const date = new Date();
    const clone = deepClone(date);
    expect(clone).toEqual(date);
    expect(clone).not.toBe(date);
  });
});

describe('pick', () => {
  it('should pick specified keys from an object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pick(obj, ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it("should ignore keys that don't exist", () => {
    const obj = { a: 1 } as Record<string, unknown>;
    expect(pick(obj, ['a', 'nonexistent' as keyof typeof obj])).toEqual({ a: 1 });
  });

  it('should return empty object for empty keys array', () => {
    const obj = { a: 1, b: 2 };
    expect(pick(obj, [])).toEqual({});
  });

  it('should not mutate the original object', () => {
    const obj = { a: 1, b: 2 };
    const result = pick(obj, ['a']);
    expect(result).toEqual({ a: 1 });
    expect(obj).toEqual({ a: 1, b: 2 });
  });
});

describe('omit', () => {
  it('should omit specified keys from an object', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ['b'])).toEqual({ a: 1, c: 3 });
  });

  it('should omit multiple keys', () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ['a', 'c'])).toEqual({ b: 2 });
  });

  it("should ignore omitted keys that don't exist", () => {
    const obj = { a: 1 } as Record<string, unknown>;
    expect(omit(obj, ['nonexistent' as keyof typeof obj])).toEqual({ a: 1 });
  });

  it('should not mutate the original object', () => {
    const obj = { a: 1, b: 2 };
    const result = omit(obj, ['a']);
    expect(result).toEqual({ b: 2 });
    expect(obj).toEqual({ a: 1, b: 2 });
  });
});

describe('isEqual', () => {
  it('should return true for identical primitives', () => {
    expect(isEqual(1, 1)).toBe(true);
    expect(isEqual('hello', 'hello')).toBe(true);
    expect(isEqual(true, true)).toBe(true);
    expect(isEqual(null, null)).toBe(true);
  });

  it('should return false for different primitives', () => {
    expect(isEqual(1, 2)).toBe(false);
    expect(isEqual('hello', 'world')).toBe(false);
    expect(isEqual(true, false)).toBe(false);
  });

  it('should return true for NaN vs NaN (JSON comparison fallback)', () => {
    // JSON.stringify(NaN) produces 'null' for both, so they compare equal
    expect(isEqual(NaN, NaN)).toBe(true);
  });

  it('should return true for equal objects', () => {
    expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('should return false for different objects', () => {
    expect(isEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('should return true for equal arrays', () => {
    expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it('should return false for different arrays', () => {
    expect(isEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('should return false when one value is null', () => {
    expect(isEqual(null, {})).toBe(false);
    expect(isEqual({}, null)).toBe(false);
  });

  it('should return false for different types', () => {
    expect(isEqual('1', 1)).toBe(false);
  });
});
describe('deepMerge prototype safety', () => {
  it('ignores __proto__/constructor source keys instead of rewriting the prototype', () => {
    const r = deepMerge(
      {} as Record<string, unknown>,
      JSON.parse('{"__proto__":{"admin":1},"ok":2}') as Record<string, unknown>,
    );
    // The inherited splice must not appear, and real keys must survive.
    expect((r as { admin?: unknown }).admin).toBeUndefined();
    expect(Object.keys(r)).toEqual(['ok']);
    expect(JSON.stringify(r)).toBe('{"ok":2}');
  });
});

describe('isEqual deep semantics', () => {
  it('is insensitive to key insertion order', () => {
    expect(isEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('distinguishes an own undefined key from an absent key', () => {
    expect(isEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
    expect(isEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
describe('pick own-property safety', () => {
  it('does not copy inherited keys', () => {
    const obj = JSON.parse('{"a":1}') as Record<string, unknown>;
    expect(pick(obj, ['toString'])).toEqual({});
  });

  it('never writes a __proto__ key into the result', () => {
    const obj = JSON.parse('{"__proto__":{"admin":1}}') as Record<string, unknown>;
    const result = pick(obj, ['__proto__']);
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect((result as any).admin).toBeUndefined();
  });
});

describe('deepMerge preserves non-plain values', () => {
  it('keeps Date values intact instead of spreading them to {}', () => {
    const result = deepMerge(
      { d: new Date(100) } as Record<string, unknown>,
      { d: new Date(200) } as Record<string, unknown>,
    );
    expect(result.d).toBeInstanceOf(Date);
    expect((result.d as Date).getTime()).toBe(200);
  });
});
