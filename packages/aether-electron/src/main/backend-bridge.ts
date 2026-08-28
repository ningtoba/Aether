/**
 * Backend Bridge — in-memory backend data stores and operations.
 *
 * Provides a direct (non-HTTP) interface that mirrors the backend API routes.
 * All data is stored in-memory for the Electron runtime.
 * This can be swapped for HTTP calls to an AetherServer later.
 */

import type {
  AgentRecord,
  ProviderRecord,
  ProviderHealthResult,
  ExecutionRecord,
  PluginRecord,
  MemoryStats,
  MemorySearchResult,
  BackendHealthStatus,
} from '../shared/ipc-protocol.js';

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

/* ─── Agent Store ─────────────────────────────────────────────────────── */

const agents = new Map<string, AgentRecord>();

export function listAgents(): AgentRecord[] {
  return Array.from(agents.values());
}

export function getAgent(id: string): AgentRecord | undefined {
  return agents.get(id);
}

export function createAgent(data: {
  name: string;
  model?: string;
  description?: string;
  config?: Record<string, unknown>;
}): AgentRecord {
  const id = uuid();
  const nowISO = now();
  const record: AgentRecord = {
    id,
    name: data.name,
    model: data.model,
    description: data.description,
    config: data.config ?? {},
    status: 'idle',
    lastRun: null,
    createdAt: nowISO,
    updatedAt: nowISO,
  };
  agents.set(id, record);
  return record;
}

export function updateAgent(id: string, data: Partial<AgentRecord>): AgentRecord | undefined {
  const existing = agents.get(id);
  if (!existing) return undefined;
  const updated: AgentRecord = {
    ...existing,
    ...data,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: now(),
  };
  agents.set(id, updated);
  return updated;
}

export function deleteAgent(id: string): boolean {
  return agents.delete(id);
}

/* ─── Provider Store ──────────────────────────────────────────────────── */

const providers = new Map<string, ProviderRecord>();

export function listProviders(): ProviderRecord[] {
  return Array.from(providers.values());
}

export function addProvider(data: {
  name: string;
  type: string;
  endpoint?: string;
  apiKey?: string;
  defaultModel?: string;
  models?: ProviderRecord['models'];
}): ProviderRecord {
  const id = uuid();
  const record: ProviderRecord = {
    id,
    name: data.name,
    type: data.type,
    endpoint: data.endpoint,
    apiKeyConfigured: !!data.apiKey,
    defaultModel: data.defaultModel,
    models: data.models,
    status: 'unknown',
    createdAt: now(),
  };
  providers.set(id, record);
  return record;
}

export function removeProvider(id: string): boolean {
  return providers.delete(id);
}

export function getProvider(id: string): ProviderRecord | undefined {
  return providers.get(id);
}

export function checkProviderHealth(id: string): ProviderHealthResult | undefined {
  const provider = providers.get(id);
  if (!provider) return undefined;

  // Simulated health check
  const result: ProviderHealthResult = {
    id: provider.id,
    name: provider.name,
    status: 'reachable',
    latency: Math.floor(Math.random() * 500) + 50,
    checkedAt: now(),
  };

  // Update the provider status
  provider.status = 'connected';
  return result;
}

/* ─── Execution Store ─────────────────────────────────────────────────── */

const executions = new Map<string, ExecutionRecord>();

export function listExecutions(): ExecutionRecord[] {
  return Array.from(executions.values());
}

export function getExecution(id: string): ExecutionRecord | undefined {
  return executions.get(id);
}

export function startExecution(data: {
  agentId?: string;
  plan?: Record<string, unknown>;
  input?: unknown;
}): ExecutionRecord {
  const id = uuid();
  const nowISO = now();
  const record: ExecutionRecord = {
    id,
    status: 'pending',
    agentId: data.agentId,
    plan: data.plan,
    input: data.input,
    createdAt: nowISO,
  };
  executions.set(id, record);

  // Simulate async execution
  setImmediate(() => {
    const exec = executions.get(id);
    // Never resurrect an execution cancelled while it was still pending.
    if (exec && exec.status === 'pending') {
      exec.status = 'running';
      exec.startedAt = now();
      setTimeout(() => {
        const e = executions.get(id);
        if (e && e.status === 'running') {
          e.status = 'completed';
          e.result = { output: 'Execution completed successfully', input: data.input };
          e.completedAt = now();
        }
      }, 2000);
    }
  });

  return record;
}

export function cancelExecution(id: string): ExecutionRecord | undefined {
  const exec = executions.get(id);
  if (!exec) return undefined;
  if (exec.status === 'completed' || exec.status === 'cancelled') {
    return exec; // Already done
  }
  exec.status = 'cancelled';
  exec.completedAt = now();
  return exec;
}

/* ─── Plugin Store ────────────────────────────────────────────────────── */

const plugins = new Map<string, PluginRecord>();

export function listPlugins(): PluginRecord[] {
  return Array.from(plugins.values());
}

export function installPlugin(data: {
  id?: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  type?: string;
  config?: Record<string, unknown>;
}): PluginRecord {
  const id = data.id ?? uuid();
  const record: PluginRecord = {
    id,
    name: data.name,
    version: data.version ?? '0.1.0',
    description: data.description ?? '',
    author: data.author ?? 'unknown',
    type: data.type ?? 'tool',
    enabled: true,
    config: data.config ?? {},
    installedAt: now(),
  };
  plugins.set(id, record);
  return record;
}

export function uninstallPlugin(id: string): boolean {
  return plugins.delete(id);
}

/* ─── Memory Store ────────────────────────────────────────────────────── */

interface MemoryDocument {
  id: string;
  content: string;
  scope: string;
  score: number;
  metadata?: Record<string, unknown>;
}

const memoryDocs: MemoryDocument[] = [
  {
    id: 'mem-1',
    content: 'User prefers concise responses with code examples',
    scope: 'user',
    score: 0.95,
  },
  {
    id: 'mem-2',
    content: 'Project uses TypeScript with strict mode enabled',
    scope: 'project',
    score: 0.88,
  },
  {
    id: 'mem-3',
    content: 'API endpoints require Bearer token authentication',
    scope: 'project',
    score: 0.72,
  },
];

export function getMemoryStats(): MemoryStats {
  return {
    type: 'InMemory',
    documentCount: memoryDocs.length,
    indexSizeKB: 42,
    dimensionCount: 1536,
    status: 'connected',
  };
}

export function searchMemory(query: string, scope?: string): MemorySearchResult[] {
  const q = query.toLowerCase();
  return memoryDocs
    .filter((d) => (scope ? d.scope === scope : true))
    .filter((d) => d.content.toLowerCase().includes(q))
    .map((d) => ({
      id: d.id,
      content: d.content,
      score: d.score,
      scope: d.scope,
      metadata: d.metadata,
    }));
}

export function clearMemory(type?: string): boolean {
  if (type) {
    // Remove only entries of a specific scope/type
    for (let i = memoryDocs.length - 1; i >= 0; i--) {
      if (memoryDocs[i].scope === type) {
        memoryDocs.splice(i, 1);
      }
    }
  } else {
    memoryDocs.length = 0;
  }
  return true;
}

/* ─── Health / aggregate stats ───────────────────────────────────────── */

export function getSystemHealth(): BackendHealthStatus {
  const mem = process.memoryUsage();
  const agentList = listAgents();
  const providerList = listProviders();
  const executionList = listExecutions();

  return {
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
    agentCount: agentList.length,
    providerCount: providerList.length,
    executionCount: executionList.length,
    timestamp: now(),
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
    },
  };
}
