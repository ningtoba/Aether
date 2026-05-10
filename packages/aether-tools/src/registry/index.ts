import {
  ToolId,
  ToolDefinition,
  ToolRegistration,
  ToolRegistryOptions,
  PermissionRequest,
  PermissionResponse,
  PermissionLevel,
  DEFAULT_RUNTIME_CONFIG,
} from '../types/index.js';
import { EventBus } from '../streaming/event-bus.js';

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRegistryError';
  }
}

export class ToolNotFoundError extends ToolRegistryError {
  constructor(toolId: string) {
    super(`Tool not found: ${toolId}`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolAlreadyRegisteredError extends ToolRegistryError {
  constructor(toolId: string) {
    super(`Tool already registered: ${toolId}`);
    this.name = 'ToolAlreadyRegisteredError';
  }
}

// ─── Registry ───────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools: Map<ToolId, ToolRegistration> = new Map();
  private eventBus: EventBus;
  private defaultPermissionResolver: (req: PermissionRequest) => Promise<PermissionResponse>;

  constructor(options?: ToolRegistryOptions) {
    this.eventBus = new EventBus();
    this.defaultPermissionResolver =
      options?.permissionResolver ?? this.defaultPermissionResolverImpl.bind(this);
  }

  // ─── Register ─────────────────────────────────────────────────────────────

  register(definition: ToolDefinition): ToolId {
    if (this.tools.has(definition.identity.id)) {
      throw new ToolAlreadyRegisteredError(definition.identity.id);
    }

    const mergedConfig = { ...DEFAULT_RUNTIME_CONFIG, ...definition.config };
    const mergedPermissions = definition.permissions ?? [];
    const tool: ToolDefinition = {
      ...definition,
      config: mergedConfig,
      permissions: mergedPermissions,
    };

    const registration: ToolRegistration = {
      definition: tool,
      enabled: true,
      registeredAt: Date.now(),
      useCount: 0,
    };

    this.tools.set(tool.identity.id, registration);
    this.eventBus.emit({
      type: 'tool:registered',
      toolId: tool.identity.id,
      timestamp: Date.now(),
      data: { name: tool.identity.name, runtime: tool.runtime },
    });

    return tool.identity.id;
  }

  // ─── Unregister ───────────────────────────────────────────────────────────

  unregister(toolId: ToolId): void {
    const reg = this.tools.get(toolId);
    if (!reg)    throw new ToolNotFoundError(toolId);

    this.tools.delete(toolId);
    this.eventBus.emit({
      type: 'tool:unregistered',
      toolId,
      timestamp: Date.now(),
    });
  }

  // ─── Lookup ───────────────────────────────────────────────────────────────

  get(toolId: ToolId): ToolDefinition | undefined {
    return this.tools.get(toolId)?.definition;
  }

  getRegistration(toolId: ToolId): ToolRegistration | undefined {
    return this.tools.get(toolId);
  }

  findByName(name: string): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((r) => r.enabled && r.definition.identity.name === name)
      .map((r) => r.definition);
  }

  findByRuntime(runtime: string): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((r) => r.enabled && r.definition.runtime === runtime)
      .map((r) => r.definition);
  }

  list(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  listEnabled(): ToolRegistration[] {
    return Array.from(this.tools.values()).filter((r) => r.enabled);
  }

  // ─── Enable / Disable ─────────────────────────────────────────────────────

  enable(toolId: ToolId): void {
    const reg = this.tools.get(toolId);
    if (!reg) throw new ToolNotFoundError(toolId);
    reg.enabled = true;
  }

  disable(toolId: ToolId): void {
    const reg = this.tools.get(toolId);
    if (!reg) throw new ToolNotFoundError(toolId);
    reg.enabled = false;
  }

  // ─── Track usage ──────────────────────────────────────────────────────────

  recordUsage(toolId: ToolId): void {
    const reg = this.tools.get(toolId);
    if (reg) {
      reg.useCount++;
      reg.lastUsedAt = Date.now();
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  get events(): EventBus {
    return this.eventBus;
  }

  // ─── Permission resolution ────────────────────────────────────────────────

  async checkPermission(req: PermissionRequest): Promise<PermissionResponse> {
    const result = await this.defaultPermissionResolver(req);
    this.eventBus.emit({
      type: result.granted ? 'permission:granted' : 'permission:denied',
      toolId: req.toolId,
      timestamp: Date.now(),
      data: { scope: req.scope, resource: req.resource, reason: result.reason },
    });
    return result;
  }

  private async defaultPermissionResolverImpl(
    req: PermissionRequest,
  ): Promise<PermissionResponse> {
    // By default, allow all
    return { granted: true, level: 'allow' as PermissionLevel };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  stats(): { total: number; enabled: number; byRuntime: Record<string, number> } {
    const byRuntime: Record<string, number> = {};
    for (const reg of this.tools.values()) {
      byRuntime[reg.definition.runtime] = (byRuntime[reg.definition.runtime] ?? 0) + 1;
    }
    return {
      total: this.tools.size,
      enabled: this.listEnabled().length,
      byRuntime,
    };
  }

  // ─── Clear ────────────────────────────────────────────────────────────────

  clear(): void {
    this.tools.clear();
  }
}
