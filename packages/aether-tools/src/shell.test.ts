/**
 * @aether/tools — shell executor tests
 *
 * Covers argument escaping for both shell families (POSIX and Windows/cmd.exe)
 * plus a real local-shell round trip on the host OS.
 */
import { describe, it, expect } from "vitest";
import { escapeShellArg, execShell } from "./shell.js";
import type { ToolDef, ToolParams } from "./types.js";

const def: ToolDef = {
  kind: "shell",
  label: "test",
  description: "test",
  timeoutMs: 5_000,
  maxOutputBytes: 64 * 1024,
  permissions: { scopes: ["shell"] },
};

describe("escapeShellArg", () => {
  describe("POSIX", () => {
    it("wraps simple args in single quotes", () => {
      expect(escapeShellArg("plain", "linux")).toBe("'plain'");
    });

    it("keeps spaces and metacharacters inside the quotes", () => {
      expect(escapeShellArg("a b", "linux")).toBe("'a b'");
      expect(escapeShellArg("a&calc", "linux")).toBe("'a&calc'");
      expect(escapeShellArg("$(touch /tmp/x)", "linux")).toBe("'$(touch /tmp/x)'");
    });

    it("escapes embedded single quotes (classic shell idiom)", () => {
      expect(escapeShellArg("it's", "linux")).toBe(`'it'\\''s'`);
    });
  });

  describe("Windows cmd.exe", () => {
    it("wraps args in double quotes, not POSIX single quotes", () => {
      expect(escapeShellArg("plain", "win32")).toBe('"plain"');
      expect(escapeShellArg("a b", "win32")).toBe('"a b"');
    });

    it("keeps cmd metacharacters inert inside double quotes", () => {
      // cmd.exe does not act on & | < > while quoted, so wrapping suffices.
      expect(escapeShellArg("a&calc", "win32")).toBe('"a&calc"');
      expect(escapeShellArg("a|b", "win32")).toBe('"a|b"');
      expect(escapeShellArg("a<b>c", "win32")).toBe('"a<b>c"');
    });

    it("prevents %VAR% expansion and delayed-expansion !, and escapes carets", () => {
      expect(escapeShellArg("%PATH%", "win32")).toBe('"^%PATH^%"');
      expect(escapeShellArg("a!b", "win32")).toBe('"a^!b"');
      expect(escapeShellArg("a^b", "win32")).toBe('"a^^b"');
    });

    it("doubles embedded double quotes", () => {
      expect(escapeShellArg('say "hi"', "win32")).toBe('"say ""hi"""');
    });
  });
});

describe("execShell", () => {
  it("passes args through literally on the host shell", async () => {
    const result = await execShell(def, {
      command: "echo",
      args: ["a b", "it's", "x&y*"],
    });
    expect(result.exitCode).toBe(0);
    // POSIX: each arg lands as a single literal token.
    expect(result.stdout.trim()).toBe("a b it's x&y*");
  });

  it("times out long-running commands", async () => {
    const result = await execShell(def, {
      command: "sleep 30",
      args: [],
    });
    // collectOutput caps via def.timeoutMs; 5s command should be killed.
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 15_000);
}, 20_000);
