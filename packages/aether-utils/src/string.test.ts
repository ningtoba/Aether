import { describe, it, expect } from "vitest";
import { truncate, slugify, capitalize, escapeHtml, template } from "./string.js";

describe("truncate", () => {
  it("should return the original string if shorter than maxLen", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should return the original string if equal to maxLen", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("should truncate with ellipsis if longer than maxLen", () => {
    const result = truncate("hello world this is long", 10);
    expect(result).toBe("hello w...");
    expect(result.length).toBe(10);
  });

  it("should handle empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("should handle maxLen of 0", () => {
    expect(truncate("hello", 0)).toBe("...");
  });

  it("should handle maxLen less than 3", () => {
    expect(truncate("hello", 1)).toBe("...");
  });
});

describe("slugify", () => {
  it("should convert to lowercase and replace spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should remove non-alphanumeric characters", () => {
    expect(slugify("Hello! @World#")).toBe("hello-world");
  });

  it("should trim leading and trailing hyphens", () => {
    expect(slugify("  --hello world--  ")).toBe("hello-world");
  });

  it("should collapse multiple separators into one", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });

  it("should handle empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("should handle strings with only special characters", () => {
    expect(slugify("!!! @@##")).toBe("");
  });
});

describe("capitalize", () => {
  it("should capitalize the first character", () => {
    expect(capitalize("hello")).toBe("Hello");
  });

  it("should not change already capitalised strings", () => {
    expect(capitalize("Hello")).toBe("Hello");
  });

  it("should handle single character", () => {
    expect(capitalize("a")).toBe("A");
  });

  it("should handle empty string", () => {
    expect(capitalize("")).toBe("");
  });

  it("should only change the first character", () => {
    expect(capitalize("hello WORLD")).toBe("Hello WORLD");
  });
});

describe("escapeHtml", () => {
  it("should escape & to &amp;", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("should escape < to &lt;", () => {
    expect(escapeHtml("<tag>")).toBe("&lt;tag&gt;");
  });

  it("should escape > to &gt;", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("should escape double quotes to &quot;", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("should escape single quotes to &#039;", () => {
    expect(escapeHtml("it's")).toBe("it&#039;s");
  });

  it("should handle a string with all special characters", () => {
    expect(escapeHtml(`<script>"alert('xss')" & foo</script>`)).toBe(
      "&lt;script&gt;&quot;alert(&#039;xss&#039;)&quot; &amp; foo&lt;/script&gt;",
    );
  });

  it("should return the original string if no special characters", () => {
    expect(escapeHtml("hello")).toBe("hello");
  });

  it("should handle empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("template", () => {
  it("should replace {{var}} placeholders", () => {
    const result = template("Hello, {{name}}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("should replace multiple placeholders", () => {
    const result = template("{{greeting}}, {{name}}!", {
      greeting: "Hi",
      name: "Alice",
    });
    expect(result).toBe("Hi, Alice!");
  });

  it("should replace unknown placeholders with empty string", () => {
    const result = template("Hello, {{name}}!", {});
    expect(result).toBe("Hello, !");
  });

  it("should handle no placeholders", () => {
    expect(template("plain text", { foo: "bar" })).toBe("plain text");
  });

  it("should handle empty template string", () => {
    expect(template("", {})).toBe("");
  });

  it("should handle curly braces without double brackets", () => {
    expect(template("{not} a {{var}}", { var: "placeholder" })).toBe("{not} a placeholder");
  });
});
