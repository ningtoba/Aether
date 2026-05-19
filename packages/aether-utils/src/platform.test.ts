import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isDev } from "./platform.js";

describe("isDev", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("should return true when NODE_ENV is 'development'", () => {
    process.env.NODE_ENV = "development";
    expect(isDev()).toBe(true);
  });

  it("should return false when NODE_ENV is 'production'", () => {
    process.env.NODE_ENV = "production";
    expect(isDev()).toBe(false);
  });

  it("should return false when NODE_ENV is 'test'", () => {
    process.env.NODE_ENV = "test";
    expect(isDev()).toBe(false);
  });

  it("should return false when NODE_ENV is undefined", () => {
    delete process.env.NODE_ENV;
    expect(isDev()).toBe(false);
  });
});
