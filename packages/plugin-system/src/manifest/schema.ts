import { z } from "zod";

// ─── Capabilities ────────────────────────────────────────────────

/** What a plugin can contribute to the Aether runtime */
export const PluginCapability = z.enum([
  "tools",        // Register tool functions available to agents
  "providers",    // Add new AI model providers (LLM, embedding, etc.)
  "memory",       // Add new memory backends
  "sandbox",      // Add new sandbox/execution environments
  "ui:panel",     // Add UI panels to the Electron app
  "ui:toolbar",   // Add toolbar buttons / commands
  "ui:view",      // Add custom view types for agent output
  "ui:settings",  // Contribute settings pages
  "lifecycle",    // Hook into agent lifecycle events
  "middleware",   // Intercept and transform agent I/O streams
]);
export type PluginCapability = z.infer<typeof PluginCapability>;

// ─── Hooks ───────────────────────────────────────────────────────

export const PluginHook = z.enum([
  "onLoad",           // Called after registration, before activation
  "onActivate",       // Called when the plugin is enabled
  "onDeactivate",     // Called when the plugin is disabled
  "onUnload",         // Called during unregistration
  "beforeAgentRun",   // Before any agent run starts
  "afterAgentRun",    // After any agent run completes
  "beforeToolCall",   // Before a tool is invoked
  "afterToolCall",    // After a tool returns
  "onConfigChange",   // Plugin config updated at runtime
]);
export type PluginHook = z.infer<typeof PluginHook>;

// ─── Manifest ────────────────────────────────────────────────────

/** Dependency constraint on another plugin or the Aether core */
export const PluginDependency = z.object({
  id: z.string().min(1).describe("Plugin ID or '@aether/*' core module"),
  version: z.string().min(1).describe("Semver constraint, e.g. '^0.1.0'"),
  optional: z.boolean().default(false).describe("Soft dependency — warn but don't fail if missing"),
});
export type PluginDependency = z.infer<typeof PluginDependency>;

/** UI contribution descriptor */
export const UIPanelContribution = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional().describe("Icon name or SVG data URL"),
  position: z.enum(["left", "right", "bottom", "modal"]).default("right"),
  entry: z.string().min(1).describe("Path to the UI module (resolved relative to plugin dir)"),
});
export type UIPanelContribution = z.infer<typeof UIPanelContribution>;

export const UIToolbarContribution = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  command: z.string().min(1).describe("Command ID that the plugin registers"),
  position: z.enum(["primary", "secondary", "contextual"]).default("secondary"),
});
export type UIToolbarContribution = z.infer<typeof UIToolbarContribution>;

export const UIViewContribution = z.object({
  type: z.string().min(1).describe("View type identifier, e.g. 'chart', 'markdown', 'custom'"),
  entry: z.string().min(1).describe("Renderer module path"),
  handles: z.array(z.string()).optional().describe("Content MIME types this viewer can render"),
});
export type UIViewContribution = z.infer<typeof UIViewContribution>;

export const UISettingsContribution = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  entry: z.string().min(1).describe("Settings page module path"),
  category: z.string().default("general").describe("Settings category grouping"),
});
export type UISettingsContribution = z.infer<typeof UISettingsContribution>;

export const UIContribution = z.object({
  panels: z.array(UIPanelContribution).default([]),
  toolbars: z.array(UIToolbarContribution).default([]),
  views: z.array(UIViewContribution).default([]),
  settings: z.array(UISettingsContribution).default([]),
});
export type UIContribution = z.infer<typeof UIContribution>;

/** Schema for a tool registered by a plugin */
export const ToolRegistration = z.object({
  name: z.string().min(1).describe("Unique tool name scoped to plugin, e.g. 'my-plugin/search'"),
  description: z.string().default("").describe("Tool description for LLM"),
  parameters: z.any().optional().describe("JSON Schema for tool parameters"),
  entry: z.string().min(1).describe("Module path exporting the tool implementation"),
  unsafe: z.boolean().default(false).describe("If true, requires explicit user approval to run"),
});
export type ToolRegistration = z.infer<typeof ToolRegistration>;

/** Provider contribution — adds a new AI model provider */
export const ProviderContribution = z.object({
  name: z.string().min(1).describe("Provider identifier, e.g. 'openai', 'anthropic', 'ollama'"),
  models: z.array(z.string()).default([]).describe("Model IDs this provider offers"),
  entry: z.string().min(1).describe("Module path exporting a ProviderAdapter"),
  configSchema: z.any().optional().describe("JSON Schema for provider configuration"),
});
export type ProviderContribution = z.infer<typeof ProviderContribution>;

/** Memory backend contribution */
export const MemoryContribution = z.object({
  name: z.string().min(1).describe("Backend identifier, e.g. 'postgres', 'sqlite', 'pgvector'"),
  entry: z.string().min(1).describe("Module path exporting a MemoryAdapter"),
});
export type MemoryContribution = z.infer<typeof MemoryContribution>;

/** Full plugin manifest */
export const PluginManifest = z.object({
  /** Unique plugin identifier, e.g. 'my-org/my-plugin' */
  id: z.string().min(1),
  /** Human-readable name */
  name: z.string().min(1),
  /** Semver version string */
  version: z.string().min(1),
  /** Short description */
  description: z.string().default(""),
  /** Author info */
  author: z.string().optional(),
  /** License identifier */
  license: z.string().default("MIT"),
  /** Minimum Aether core version required */
  aetherVersion: z.string().default(">=0.1.0"),
  /** Plugin dependencies */
  dependencies: z.array(PluginDependency).default([]),
  /** Capabilities this plugin provides */
  capabilities: z.array(PluginCapability).default([]),
  /** Lifecycle hooks this plugin implements */
  hooks: z.array(PluginHook).default([]),
  /** Tool registrations */
  tools: z.array(ToolRegistration).default([]),
  /** Provider contributions */
  providers: z.array(ProviderContribution).default([]),
  /** Memory backend contributions */
  memoryBackends: z.array(MemoryContribution).default([]),
  /** UI contributions */
  ui: UIContribution.default({}),
  /** Configuration schema (JSON Schema) for plugin settings */
  configSchema: z.any().optional(),
  /** Default configuration values */
  defaultConfig: z.record(z.any()).default({}),
  /** Entry point module path (relative to plugin directory) */
  main: z.string().optional().describe("Plugin runtime entry point, called on activation"),
});
export type PluginManifest = z.infer<typeof PluginManifest>;

// ─── Runtime types ───────────────────────────────────────────────

/** Runtime status of a loaded plugin */
export type PluginStatus = "registered" | "loading" | "active" | "inactive" | "error" | "unloaded";

/** Dependency resolution result for a plugin */
export type PluginDependencyGraph = Map<string, string[]>; // pluginId -> dependency IDs

/** Errors */
export class PluginManifestError extends Error {
  constructor(message: string, public readonly issues?: z.ZodError["issues"]) {
    super(message);
    this.name = "PluginManifestError";
  }
}

export class PluginDependencyError extends Error {
  constructor(
    message: string,
    public readonly pluginId: string,
    public readonly missing: string[],
  ) {
    super(message);
    this.name = "PluginDependencyError";
  }
}
