/**
 * Integration tests for @aether/utils
 *
 * Tests utility chains working together: retry with exponential backoff,
 * deepMerge with complex nested objects, ID generation uniqueness,
 * and template string replacement with edge cases.
 */
import { describe, it, expect } from "vitest";
import { retry, delay, withTimeout } from "./async.js";
import { deepMerge, deepClone, pick, omit, isEqual } from "./object.js";
import { generateId, generateShortId, isValidId } from "./id.js";
import { template, truncate, slugify, capitalize, escapeHtml } from "./string.js";

// ---------------------------------------------------------------------------
// Async chain: retry with exponential backoff that eventually succeeds
// ---------------------------------------------------------------------------
describe("async integration", () => {
  it("retry with exponential backoff: eventually succeeds after failures", async () => {
    let attempt = 0;
    const fn = async () => {
      attempt++;
      if (attempt < 3) throw new Error(`Attempt ${attempt} failed`);
      return "success";
    };

    const result = await retry(fn, {
      maxAttempts: 5,
      baseDelay: 10,
      maxDelay: 100,
      backoff: "exponential",
    });

    expect(result).toBe("success");
    expect(attempt).toBe(3);
  });

  it("retry exhausts all attempts and throws if never succeeds", async () => {
    const fn = async () => {
      throw new Error("always fails");
    };

    await expect(
      retry(fn, {
        maxAttempts: 3,
        baseDelay: 10,
        maxDelay: 50,
        backoff: "fixed",
      })
    ).rejects.toThrow("always fails");
  });

  it("withTimeout rejects when promise is too slow", async () => {
    await expect(
      withTimeout(delay(500), 50, "too slow")
    ).rejects.toThrow("too slow");
  });

  it("withTimeout resolves when promise finishes in time", async () => {
    const result = await withTimeout(
      Promise.resolve("fast enough"),
      100
    );
    expect(result).toBe("fast enough");
  });
});

// ---------------------------------------------------------------------------
// Object utilities combined: deepMerge with complex nested objects
// ---------------------------------------------------------------------------
describe("object utilities integration", () => {
  it("deepMerge merges complex nested objects without mutation", () => {
    const target: Record<string, unknown> = {
      name: "config",
      nested: {
        a: 1,
        b: 2,
        deep: {
          x: 10,
          y: 20,
        },
      },
      arr: [1, 2, 3],
      keep: "me",
    };

    const source: Record<string, unknown> = {
      nested: {
        b: 99,
        deep: {
          y: 200,
          z: 30,
        },
        extra: "new",
      },
      arr: [4, 5, 6],
      newKey: "added",
    };

    const originalNested = target.nested as Record<string, unknown>;
    const originalDeep = originalNested.deep as Record<string, unknown>;

    // Original unchanged after merge
    expect(originalNested.a).toBe(1);
    expect(originalNested.b).toBe(2);
    expect(originalDeep.y).toBe(20);

    const merged = deepMerge(target, source);
    const mergedNested = merged.nested as Record<string, unknown>;
    const mergedDeep = mergedNested.deep as Record<string, unknown>;

    // Merged has combined nested values
    expect(merged.name).toBe("config");
    expect(mergedNested.a).toBe(1);            // from target
    expect(mergedNested.b).toBe(99);            // from source (overwritten)
    expect(mergedDeep.x).toBe(10);              // from target
    expect(mergedDeep.y).toBe(200);             // from source (overwritten)
    expect(mergedDeep.z).toBe(30);              // from source
    expect(mergedNested.extra).toBe("new");     // from source
    expect(merged.keep).toBe("me");
    expect(merged.newKey).toBe("added");

    // Arrays are replaced, not merged
    expect(merged.arr).toEqual([4, 5, 6]);
  });

  it("deepMerge handles empty and undefined values", () => {
    const merged = deepMerge({ a: 1, b: { c: 2 } } as Record<string, unknown>, { b: {}, c: undefined });
    const mb = merged.b as Record<string, unknown>;
    expect(mb.c).toBe(2);
    expect(merged.c).toBe(undefined);
  });

  it("deepClone creates a full deep copy", () => {
    const original = { a: 1, b: { c: [1, 2, { d: 3 }] } };
    const cloned = deepClone(original);
    (cloned.b.c[2] as Record<string, number>).d = 99;
    expect((original.b.c[2] as Record<string, number>).d).toBe(3); // original unchanged
  });

  it("pick extracts specific keys", () => {
    const obj = { a: 1, b: 2, c: 3, d: 4 };
    expect(pick(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  it("omit removes specific keys", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(omit(obj, ["b"])).toEqual({ a: 1, c: 3 });
  });

  it("isEqual compares deeply via JSON", () => {
    expect(isEqual({ a: { b: [1] } }, { a: { b: [1] } })).toBe(true);
    expect(isEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isEqual(null, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ID generation uniqueness
// ---------------------------------------------------------------------------
describe("id generation integration", () => {
  it("generateId produces unique IDs (1000 generated, no duplicates)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it("generateId respects custom prefix", () => {
    const id = generateId("test");
    expect(id).toMatch(/^test_/);
    expect(isValidId(id)).toBe(true);
  });

  it("generateShortId produces unique short IDs (1000 generated)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateShortId());
    }
    expect(ids.size).toBe(1000);
    // Short IDs are 8 hex chars
    ids.forEach((id) => {
      expect(id).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  it("isValidId rejects invalid formats", () => {
    expect(isValidId("not_an_id")).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId("aether_")).toBe(false);
    expect(isValidId("AETHER_1234")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String utilities: template with edge cases
// ---------------------------------------------------------------------------
describe("string utilities integration", () => {
  it("template replaces {{var}} placeholders", () => {
    const result = template("Hello {{name}}, your score is {{score}}", {
      name: "Alice",
      score: "95",
    });
    expect(result).toBe("Hello Alice, your score is 95");
  });

  it("template leaves unmatched placeholders as empty string", () => {
    const result = template("Hello {{name}}, {{missing}}", {
      name: "Bob",
    });
    expect(result).toBe("Hello Bob, ");
  });

  it("template handles empty template and empty vars", () => {
    expect(template("", {})).toBe("");
    expect(template("no placeholders", { a: "1" })).toBe("no placeholders");
  });

  it("template replaces multiple occurrences of same var", () => {
    const result = template("{{x}} + {{x}} = {{y}}", { x: "1", y: "2" });
    expect(result).toBe("1 + 1 = 2");
  });

  it("truncate adds ellipsis when exceeding max length", () => {
    expect(truncate("Hello World", 5)).toBe("He...");
    expect(truncate("Hello", 10)).toBe("Hello");
  });

  it("slugify produces URL-safe slugs", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("  Extra   spaces  ")).toBe("extra-spaces");
    expect(slugify("Special!@#Chars")).toBe("special-chars");
  });

  it("capitalize works on various inputs", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("")).toBe("");
    expect(capitalize("a")).toBe("A");
  });

  it("escapeHtml escapes all HTML special characters", () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });
});
