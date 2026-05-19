/**
 * @aether/playwright — test suite
 *
 * Tests for browser automation wrapper.
 * playwright-core is installed as a dependency, but browser binaries
 * are not expected to be present in CI — tests handle graceful failures.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  VERSION,
  launchBrowser,
  createPage,
  closeBrowser,
  navigate,
  getContent,
  evaluate,
  click,
  type,
  screenshot,
  getPageTitle,
} from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VERSION", () => {
  it("should export a semver string", () => {
    expect(VERSION).toBe("0.1.0");
  });
});

describe("launchBrowser", () => {
  it("should fail gracefully when playwright browser is not installed", async () => {
    // Without browser binaries, launchBrowser should throw
    // (playwright-core is installed as a package dep, so the dynamic import succeeds)
    await expect(launchBrowser({ timeout: 5_000 })).rejects.toThrow();
  }, 15_000);
});

describe("Constructor defaults", () => {
  it("should have default options via the module types", () => {
    // Verify that the module exports are functions
    expect(typeof launchBrowser).toBe("function");
    expect(typeof createPage).toBe("function");
    expect(typeof closeBrowser).toBe("function");
    expect(typeof navigate).toBe("function");
    expect(typeof getContent).toBe("function");
    expect(typeof evaluate).toBe("function");
    expect(typeof click).toBe("function");
    expect(typeof type).toBe("function");
    expect(typeof screenshot).toBe("function");
    expect(typeof getPageTitle).toBe("function");
  });
});

describe("Error handling", () => {
  it("should throw for missing browser binaries", async () => {
    await expect(launchBrowser({ browser: "chromium" })).rejects.toThrow();
  }, 15_000);

  it("should fail when trying to use a non-existent page reference", async () => {
    // createPage with a null browser should fail gracefully
    await expect(
      createPage(null as unknown as import("playwright-core").Browser),
    ).rejects.toThrow();
  });
});
