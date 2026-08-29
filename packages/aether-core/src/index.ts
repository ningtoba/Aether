/**
 * @aether/core — merged foundation package.
 *
 * Absorbs the former aether-core (events/lifecycle/config), aether-types,
 * aether-utils, aether-telemetry and aether-security into a single
 * dependency-free-ish foundation. External consumers import from the package
 * root; the telemetry/types/utils surfaces are additionally exposed as
 * namespaces (`core.telemetry`, `core.types`, `core.utils`) so identifier
 * collisions (e.g. `LogLevel`) never leak into the top-level barrel.
 *
 * @module @aether/core
 */

// ── Core (events / lifecycle / config) ─────────────────────────────────────
export { EventBus } from './events.js';
export type { EventHandler, EventBusOptions } from './events.js';
export { LifecycleManager } from './lifecycle.js';
export type { LifecycleStage, LifecycleHook } from './lifecycle.js';
export { ConfigManager } from './config.js';

// ── Security (RBAC) — top level so `import { RBACGuard } from '@aether/core'` works.
export * from './security/index.js';

// ── Namespaced subsystems (collision-safe) ────────────────────────────────
export * as types from './domain/index.js';
export * as utils from './utils/index.js';
export * as telemetry from './telemetry/index.js';
