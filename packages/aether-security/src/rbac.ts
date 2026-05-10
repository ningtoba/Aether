/**
 * RBAC (Role-Based Access Control) system.
 *
 * Defines roles, permissions, and resource-based access control rules
 * that govern what agents and users can do within the Aether platform.
 *
 * ── Design ──
 * - Roles are hierarchical (inheritance via extends)
 * - Permissions are resource + action tuples
 * - Access decisions checked through a central guard
 * - Supports wildcard actions ("*") and resource patterns (glob)
 */

// ─── Core types ────────────────────────────────────────────────────────

/** Unique role identifier. */
export type RoleId = string & { readonly __brand: "RoleId" };

/** A typed permission — grants an action on a resource. */
export interface Permission {
  /** Resource pattern, e.g. "tools:*", "providers:openai", "agents:agent-*" */
  resource: string;
  /** Action(s) allowed, e.g. "read", "write", "delete", "execute", or "*" for all */
  action: string | string[];
  /** Optional reason for the permission (audit trail). */
  reason?: string;
}

/** A role definition. */
export interface RoleDefinition {
  readonly id: RoleId;
  readonly name: string;
  readonly description: string;
  /** Permissions granted by this role. */
  readonly permissions: Permission[];
  /** Parent role IDs — child inherits all parent permissions. */
  readonly extends?: RoleId[];
  /** Whether this is a built-in system role (cannot be deleted). */
  readonly system?: boolean;
}

/** An access control decision. */
export interface AccessDecision {
  readonly granted: boolean;
  readonly role: RoleId;
  readonly permission: string; // human-readable summary
  readonly reason?: string;
  readonly evaluatedAt: number;
}

// ─── Built-in role definitions ──────────────────────────────────────────

export const BUILTIN_ROLES: Record<string, RoleDefinition> = {
  admin: {
    id: "admin" as RoleId,
    name: "Administrator",
    description: "Full unrestricted access to all resources and operations.",
    permissions: [{ resource: "*", action: "*", reason: "Administrator — full access" }],
    system: true,
  },
  operator: {
    id: "operator" as RoleId,
    name: "Operator",
    description: "Operational access — manage agents, view logs, execute tools.",
    permissions: [
      { resource: "agents:*", action: ["read", "execute"], reason: "Operators can execute agents" },
      { resource: "tools:*", action: ["read", "execute"], reason: "Operators can use tools" },
      { resource: "logs:*", action: ["read"], reason: "Operators can view logs" },
      { resource: "system:status", action: ["read"], reason: "Operators can check system status" },
    ],
    extends: [],
    system: true,
  },
  developer: {
    id: "developer" as RoleId,
    name: "Developer",
    description: "Create and modify agents, tools, and configurations.",
    permissions: [
      { resource: "agents:*", action: ["read", "write", "execute"], reason: "Developers manage agents" },
      { resource: "tools:custom:*", action: ["read", "write", "execute"], reason: "Developers create custom tools" },
      { resource: "providers:config", action: ["read"], reason: "Developers can view provider config" },
      { resource: "logs:*", action: ["read"], reason: "Developers can view logs" },
    ],
    extends: [],
    system: true,
  },
  agent: {
    id: "agent" as RoleId,
    name: "Agent Runtime",
    description: "Minimum permissions for an autonomous agent to operate.",
    permissions: [
      { resource: "tools:runtime:*", action: ["execute"], reason: "Agents can run tools" },
      { resource: "memory:session:*", action: ["read", "write"], reason: "Agents can read/write their session memory" },
      { resource: "system:health", action: ["read"], reason: "Agents can check health" },
    ],
    extends: [],
    system: true,
  },
  viewer: {
    id: "viewer" as RoleId,
    name: "Viewer",
    description: "Read-only access to agents, logs, and system status.",
    permissions: [
      { resource: "agents:*", action: ["read"], reason: "Viewers can view agents" },
      { resource: "logs:*", action: ["read"], reason: "Viewers can view logs" },
      { resource: "system:*", action: ["read"], reason: "Viewers can read system info" },
    ],
    extends: [],
    system: true,
  },
};

// ─── Permission matching ────────────────────────────────────────────────

/** Convert a glob-style resource pattern to RegExp. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/** Check whether a permission grants access to a given resource+action. */
export function permissionMatches(
  permission: Permission,
  resource: string,
  action: string,
): boolean {
  const resourceMatch = globToRegex(permission.resource).test(resource);
  if (!resourceMatch) return false; // short-circuit

  if (permission.action === "*") return true | true; // wildcard
  const actions = Array.isArray(permission.action) ? permission.action : [permission.action];
  return actions.some((a) => a === "*" || a === action);
}

// ─── RBAC Guard ─────────────────────────────────────────────────────────

export interface RBACGuardOptions {
  /** Additional roles to register on construction (beyond built-ins). */
  extraRoles?: RoleDefinition[];
  /** Whether to deny by default (default: true — security-first). */
  denyByDefault?: boolean;
}

/**
 * Central RBAC guard.
 *
 * Resolves access decisions by checking the subject's assigned roles
 * (including inherited parent permissions) against the requested
 * resource + action.
 */
export class RBACGuard {
  private roles: Map<RoleId, RoleDefinition> = new Map();
  private denyByDefault: boolean;

  constructor(options: RBACGuardOptions = {}) {
    this.denyByDefault = options.denyByDefault ?? true;

    // Register built-in roles
    for (const role of Object.values(BUILTIN_ROLES)) {
      this.roles.set(role.id, role);
    }

    // Register extra roles
    if (options.extraRoles) {
      for (const role of options.extraRoles) {
        this.registerRole(role);
      }
    }
  }

  // ── Role management ─────────────────────────────────────────────

  /** Register a new role (throws if id already registered). */
  registerRole(role: RoleDefinition): void {
    if (this.roles.has(role.id)) {
      throw new Error(`Role '${role.id}' is already registered`);
    }
    this.roles.set(role.id, role);
  }

  /** Remove a role (throws if it's a system role). */
  removeRole(roleId: RoleId): void {
    const role = this.roles.get(roleId);
    if (!role) throw new Error(`Role '${roleId}' not found`);
    if (role.system) throw new Error(`Cannot remove system role '${roleId}'`);
    this.roles.delete(roleId);
  }

  /** Get a role definition. */
  getRole(roleId: RoleId): RoleDefinition | undefined {
    return this.roles.get(roleId);
  }

  /** List all registered roles. */
  listRoles(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  /** Check if a role exists. */
  hasRole(roleId: RoleId): boolean {
    return this.roles.has(roleId);
  }

  // ── Permission resolution ───────────────────────────────────────

  /** Resolve the effective permissions for a set of roles (including inheritance). */
  resolveEffectivePermissions(roleIds: RoleId[]): Map<RoleId, Permission[]> {
    const result = new Map<RoleId, Permission[]>();
    const visited = new Set<RoleId>();

    const walk = (id: RoleId): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const role = this.roles.get(id);
      if (!role) return;

      // Collect direct permissions
      const perms = [...role.permissions];

      // Inherit from parent roles
      if (role.extends) {
        for (const parentId of role.extends) {
          walk(parentId);
          const parentPerms = result.get(parentId);
          if (parentPerms) {
            perms.push(...parentPerms);
          }
        }
      }

      result.set(id, perms);
    };

    for (const id of roleIds) {
      walk(id);
    }

    return result;
  }

  /**
   * Check whether a set of roles is allowed to perform `action` on `resource`.
   *
   * Returns an AccessDecision with the first matching permission.
   * If deny-by-default and no permission matches, access is denied.
   */
  checkAccess(
    roleIds: RoleId[],
    resource: string,
    action: string,
  ): AccessDecision {
    const effectivePerms = this.resolveEffectivePermissions(roleIds);

    // Flatten all inherited permissions
    const allPermissions: { role: string; perm: Permission }[] = [];
    for (const [roleId, perms] of effectivePerms) {
      for (const perm of perms) {
        allPermissions.push({ role: roleId, perm });
      }
    }

    // Sort: more specific resource patterns first
    allPermissions.sort((a, b) => {
      const aWild = (a.perm.resource.match(/\*/g) ?? []).length;
      const bWild = (b.perm.resource.match(/\*/g) ?? []).length;
      return aWild - bWild;
    });

    // Find first match
    for (const { role, perm } of allPermissions) {
      if (permissionMatches(perm, resource, action)) {
        return {
          granted: true,
          role: role as RoleId,
          permission: `${perm.action} on ${perm.resource}`,
          reason: perm.reason,
          evaluatedAt: Date.now(),
        };
      }
    }

    // Deny by default
    return {
      granted: false,
      role: "" as RoleId,
      permission: `${action} on ${resource}`,
      reason: this.denyByDefault ? "Denied by default — no matching permission" : "No permission granted",
      evaluatedAt: Date.now(),
    };
  }

  /** Convenience: boolean check without full decision object. */
  isAllowed(roleIds: RoleId[], resource: string, action: string): boolean {
    return this.checkAccess(roleIds, resource, action).granted;
  }
}
