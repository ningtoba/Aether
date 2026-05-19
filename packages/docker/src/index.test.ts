/**
 * @aether/docker — test suite
 *
 * Tests for Docker sandbox management utilities.
 * Tests gracefully handle the case where Docker is not available.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  VERSION,
  createSandbox,
  destroySandbox,
  execInSandbox,
  copyFilesToSandbox,
  checkDockerEnv,
} from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VERSION", () => {
  it("should export version string", () => {
    expect(VERSION).toBe("0.1.0");
  });
});

describe("checkDockerEnv", () => {
  it("should return Docker availability status (ready or not)", async () => {
    const status = await checkDockerEnv();
    // Must have the expected shape regardless of Docker availability
    expect(status).toHaveProperty("ready");
    expect(status).toHaveProperty("type", "docker");

    if (status.ready) {
      expect(status.version).toBeDefined();
      expect(status.info).toBeDefined();
    } else {
      expect(status.error).toBeDefined();
    }
  });
});

describe("createSandbox", () => {
  it("should throw if Docker is not available", async () => {
    const status = await checkDockerEnv();
    if (!status.ready) {
      await expect(createSandbox()).rejects.toThrow("Docker is not available");
    }
    // If Docker is available, we could test creating a sandbox,
    // but that requires Docker daemon — skip in CI
  });
});

describe("destroySandbox", () => {
  it("should not throw for non-existent container", async () => {
    // This should be a no-op even without Docker
    await expect(
      destroySandbox("nonexistent-container-id"),
    ).resolves.toBeUndefined();
  });
});

describe("execInSandbox", () => {
  it("should throw for non-existent container", async () => {
    const status = await checkDockerEnv();
    if (!status.ready) {
      await expect(
        execInSandbox("nonexistent", "echo hi"),
      ).rejects.toThrow();
    }
    // If Docker is available, test would need a running container — skip
  });
});

describe("copyFilesToSandbox", () => {
  it("should throw for non-existent container", async () => {
    await expect(
      copyFilesToSandbox("nonexistent", [{ path: "test.txt", content: "hi" }]),
    ).rejects.toThrow();
  });
});
