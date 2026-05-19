import { describe, it, expect, beforeEach } from "vitest";
import { RBACGuard, permissionMatches, BUILTIN_ROLES } from "./rbac.js";
import type { RoleId, RoleDefinition, Permission } from "./rbac.js";

describe("RBACGuard", () => {
  let guard: RBACGuard;

  beforeEach(() => {
    guard = new RBACGuard();
  });

  describe("construction", () => {
    it("should register all built-in roles by default", () => {
      expect(guard.listRoles()).toHaveLength(5);
      expect(guard.hasRole("admin" as RoleId)).toBe(true);
      expect(guard.hasRole("operator" as RoleId)).toBe(true);
      expect(guard.hasRole("developer" as RoleId)).toBe(true);
      expect(guard.hasRole("agent" as RoleId)).toBe(true);
      expect(guard.hasRole("viewer" as RoleId)).toBe(true);
    });

    it("should register extra roles passed in options", () => {
      const extra: RoleDefinition = {
        id: "custom" as RoleId,
        name: "Custom",
        description: "A custom role",
        permissions: [{ resource: "custom:*", action: "read" }],
      };
      const g = new RBACGuard({ extraRoles: [extra] });
      expect(g.hasRole("custom" as RoleId)).toBe(true);
    });

    it("should support denyByDefault: false", () => {
      const g = new RBACGuard({ denyByDefault: false });
      expect(g.isAllowed([] as RoleId[], "any:resource", "anyAction")).toBe(false);
      // Still denied because no permissions match, but reason differs
      const decision = g.checkAccess([] as RoleId[], "any:resource", "anyAction");
      expect(decision.reason).toBe("No permission granted");
    });
  });

  describe("registerRole", () => {
    it("should register a new role", () => {
      const role: RoleDefinition = {
        id: "auditor" as RoleId,
        name: "Auditor",
        description: "Audit access",
        permissions: [{ resource: "logs:*", action: "read" }],
      };
      guard.registerRole(role);
      expect(guard.hasRole("auditor" as RoleId)).toBe(true);
    });

    it("should throw when registering a duplicate role", () => {
      expect(() =>
        guard.registerRole({
          id: "admin" as RoleId,
          name: "Admin Dupe",
          description: "",
          permissions: [],
        }),
      ).toThrow("already registered");
    });
  });

  describe("removeRole", () => {
    it("should remove a non-system role", () => {
      guard.registerRole({
        id: "temp" as RoleId,
        name: "Temporary",
        description: "",
        permissions: [],
      });
      guard.removeRole("temp" as RoleId);
      expect(guard.hasRole("temp" as RoleId)).toBe(false);
    });

    it("should throw when removing a system role", () => {
      expect(() => guard.removeRole("admin" as RoleId)).toThrow("Cannot remove system role");
    });

    it("should throw when removing a non-existent role", () => {
      expect(() => guard.removeRole("nonexistent" as RoleId)).toThrow("not found");
    });
  });

  describe("getRole / listRoles / hasRole", () => {
    it("getRole should return the role definition", () => {
      const role = guard.getRole("admin" as RoleId);
      expect(role).toBeDefined();
      expect(role!.name).toBe("Administrator");
    });

    it("getRole should return undefined for unknown role", () => {
      expect(guard.getRole("unknown" as RoleId)).toBeUndefined();
    });

    it("listRoles should return all registered roles", () => {
      const roles = guard.listRoles();
      expect(roles.length).toBe(5);
      expect(roles.map((r) => r.id)).toContain("admin" as RoleId);
    });

    it("hasRole should return false for non-existent role", () => {
      expect(guard.hasRole("nope" as RoleId)).toBe(false);
    });
  });

  describe("permissionMatches", () => {
    it("should match exact resource and action", () => {
      const perm: Permission = { resource: "agents:agent-1", action: "read" };
      expect(permissionMatches(perm, "agents:agent-1", "read")).toBe(true);
    });

    it("should reject mismatched resource", () => {
      const perm: Permission = { resource: "agents:agent-1", action: "read" };
      expect(permissionMatches(perm, "agents:agent-2", "read")).toBe(false);
    });

    it("should reject mismatched action", () => {
      const perm: Permission = { resource: "agents:*", action: "read" };
      expect(permissionMatches(perm, "agents:agent-1", "write")).toBe(false);
    });

    it("should match wildcard action '*'", () => {
      const perm: Permission = { resource: "*", action: "*" };
      expect(permissionMatches(perm, "anything:here", "any_action")).toBe(true);
    });

    it("should match glob resource pattern with '*'", () => {
      const perm: Permission = { resource: "tools:*", action: "execute" };
      expect(permissionMatches(perm, "tools:my-tool", "execute")).toBe(true);
      expect(permissionMatches(perm, "tools:sub:thing", "execute")).toBe(true);
    });

    it("should match multiple actions via array", () => {
      const perm: Permission = { resource: "logs:*", action: ["read", "write"] };
      expect(permissionMatches(perm, "logs:file1", "read")).toBe(true);
      expect(permissionMatches(perm, "logs:file1", "write")).toBe(true);
      expect(permissionMatches(perm, "logs:file1", "delete")).toBe(false);
    });

    it("should handle single action string", () => {
      const perm: Permission = { resource: "system:health", action: "read" };
      expect(permissionMatches(perm, "system:health", "read")).toBe(true);
    });
  });

  describe("resolveEffectivePermissions", () => {
    it("should return direct permissions for a role with no parents", () => {
      const perms = guard.resolveEffectivePermissions(["viewer" as RoleId]);
      const viewerPerms = perms.get("viewer" as RoleId);
      expect(viewerPerms).toBeDefined();
      expect(viewerPerms!.length).toBeGreaterThan(0);
    });

    it("should inherit parent permissions for child roles", () => {
      guard.registerRole({
        id: "child_role" as RoleId,
        name: "Child",
        description: "",
        permissions: [{ resource: "child:resource", action: "read" }],
        extends: ["viewer" as RoleId],
      });

      const perms = guard.resolveEffectivePermissions(["child_role" as RoleId]);
      const childPerms = perms.get("child_role" as RoleId);
      expect(childPerms).toBeDefined();
      // Should have both child's own permissions and inherited viewer permissions
      expect(childPerms!.some((p) => p.resource === "child:resource")).toBe(true);
      expect(childPerms!.some((p) => p.resource === "agents:*")).toBe(true); // from viewer
    });

    it("should handle circular inheritance gracefully", () => {
      guard.registerRole({
        id: "a" as RoleId,
        name: "A",
        description: "",
        permissions: [],
        extends: ["b" as RoleId],
      });
      guard.registerRole({
        id: "b" as RoleId,
        name: "B",
        description: "",
        permissions: [],
        extends: ["a" as RoleId],
      });

      // Should not infinite-loop
      const perms = guard.resolveEffectivePermissions(["a" as RoleId]);
      expect(perms.has("a" as RoleId)).toBe(true);
    });
  });

  describe("checkAccess", () => {
    it("should grant access for admin on any resource", () => {
      const decision = guard.checkAccess(["admin" as RoleId], "some:resource", "delete");
      expect(decision.granted).toBe(true);
      expect(decision.role).toBe("admin");
    });

    it("should grant operator access to execute agents", () => {
      expect(guard.isAllowed(["operator" as RoleId], "agents:my-agent", "execute")).toBe(true);
    });

    it("should deny operator write access to agents", () => {
      expect(guard.isAllowed(["operator" as RoleId], "agents:my-agent", "write")).toBe(false);
    });

    it("should grant developer read/write/execute on agents", () => {
      expect(guard.isAllowed(["developer" as RoleId], "agents:any", "read")).toBe(true);
      expect(guard.isAllowed(["developer" as RoleId], "agents:any", "write")).toBe(true);
      expect(guard.isAllowed(["developer" as RoleId], "agents:any", "execute")).toBe(true);
    });

    it("should grant agent execute on runtime tools", () => {
      expect(guard.isAllowed(["agent" as RoleId], "tools:runtime:search", "execute")).toBe(true);
    });

    it("should deny agent write on tools", () => {
      expect(guard.isAllowed(["agent" as RoleId], "tools:runtime:search", "write")).toBe(false);
    });

    it("should grant viewer read on agents", () => {
      expect(guard.isAllowed(["viewer" as RoleId], "agents:any-agent", "read")).toBe(true);
    });

    it("should deny viewer write on agents", () => {
      expect(guard.isAllowed(["viewer" as RoleId], "agents:any-agent", "write")).toBe(false);
    });

    it("should deny unknown roles by default", () => {
      guard.registerRole({
        id: "unknown" as RoleId,
        name: "Unknown",
        description: "",
        permissions: [],
      });
      expect(guard.isAllowed(["unknown" as RoleId], "anything", "read")).toBe(false);
    });

    it("should return a structured AccessDecision on denial", () => {
      const decision = guard.checkAccess(["viewer" as RoleId], "agents:secret", "delete");
      expect(decision.granted).toBe(false);
      expect(decision.permission).toBe("delete on agents:secret");
      expect(typeof decision.evaluatedAt).toBe("number");
    });

    it("should match more specific permissions before wildcard ones", () => {
      guard.registerRole({
        id: "specific" as RoleId,
        name: "Specific",
        description: "",
        permissions: [
          { resource: "tools:runtime:search", action: "execute" },
          { resource: "tools:*", action: "execute" },
        ],
      });
      const decision = guard.checkAccess(["specific" as RoleId], "tools:runtime:search", "execute");
      expect(decision.granted).toBe(true);
      // The more specific match should be returned
      expect(decision.permission).toBe("execute on tools:runtime:search");
    });
  });

  describe("isAllowed", () => {
    it("should return true for allowed access", () => {
      expect(guard.isAllowed(["admin" as RoleId], "any:thing", "do")).toBe(true);
    });

    it("should return false for denied access", () => {
      expect(guard.isAllowed(["viewer" as RoleId], "agents:a", "delete")).toBe(false);
    });
  });
});

describe("BUILTIN_ROLES", () => {
  it("should have 5 built-in roles", () => {
    expect(Object.keys(BUILTIN_ROLES)).toHaveLength(5);
  });

  it("admin should have wildcard permission", () => {
    expect(BUILTIN_ROLES.admin.permissions).toContainEqual(
      expect.objectContaining({ resource: "*", action: "*" }),
    );
  });

  it("all built-in roles should be marked as system", () => {
    for (const role of Object.values(BUILTIN_ROLES)) {
      expect(role.system).toBe(true);
    }
  });
});
