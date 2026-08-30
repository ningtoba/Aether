/**
 * @aether/core — security foundation for the Aether platform.
 *
 * RBAC only: hierarchical role-based access control with glob resource
 * matching (`RBACGuard`, `BUILTIN_ROLES`, `permissionMatches`). This is the
 * sole surface with production consumers — `@aether/backend`'s route gate.
 *
 * The package's former foundation payload (EventBus, LifecycleManager,
 * ConfigManager, and the types/utils/telemetry namespaces) was deleted in
 * iteration 8: a repo-wide grep proved zero consumers outside this package,
 * and with it went the entire OpenTelemetry + pino dependency tree.
 *
 * @module @aether/core
 */

export * from './security/index.js';
