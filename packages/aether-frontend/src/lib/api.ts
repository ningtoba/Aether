/**
 * API client for the Aether backend.
 *
 * Thin typed wrapper over the REST endpoints exposed by aether-backend.
 * The realtime event stream is separate (BunRealtimeHub on <REALTIME_PORT>);
 * see realtime.ts.
 */

const BASE = import.meta.env?.VITE_API_BASE ?? '';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)
        ? String((body as { error: unknown }).error)
        : null) ?? `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

/* ── Health ─────────────────────────────────────────────────────────── */

export interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  providers: { configured: number; healthy: number };
  timestamp: string;
  realtime?: { port: number };
  engine?: { available: boolean; error?: string | null };
}

export const getHealth = () => request<HealthStatus>('/health');

/* ── Models ─────────────────────────────────────────────────────────── */

export interface ModelRecord {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  baseUrl?: string;
  isEmbedded: boolean;
}

export interface ModelGroup {
  provider: string;
  models: ModelRecord[];
}

export const listModels = () => request<{ groups: ModelGroup[] }>('/api/models');

/* ── Sessions ───────────────────────────────────────────────────────── */

export interface SessionSummary {
  id: string;
  name: string;
  cwd: string;
  model: { provider: string; modelId: string };
  status: string;
  messageCount: number;
  createdAt: string;
}

export const listSessions = () => request<{ sessions: SessionSummary[] }>('/api/sessions');

export const createSession = (model: { provider: string; modelId: string }, cwd?: string) =>
  request<{ session: SessionSummary }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ model, cwd }),
  });

export const getSession = (id: string) =>
  request<{ session: SessionSummary }>(`/api/sessions/${id}`);

export const promptSession = (id: string, message: string) =>
  request<{ accepted: boolean }>(`/api/sessions/${id}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });

export const compactSession = (id: string) =>
  request<{ ok: boolean }>(`/api/sessions/${id}/compact`, { method: 'POST' });

export const disposeSession = (id: string) =>
  request<{ ok: boolean }>(`/api/sessions/${id}/dispose`, { method: 'POST' });

/* ── Loops ──────────────────────────────────────────────────────────── */

export type LoopTransitionKind = 'none' | 'compact' | 'skill' | 'gate';

export interface LoopTransition {
  kind: LoopTransitionKind;
  skillName?: string;
}

export interface LoopDefinition {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  transition: LoopTransition;
  maxRounds?: number;
  maxTimeMs?: number;
  cwd: string;
  model: { provider: string; modelId: string };
}

export interface LoopRoundResult {
  round: number;
  startedAt: string;
  finishedAt: string;
  summary?: string;
  errored: boolean;
}

export interface LoopProgress {
  id: string;
  status: 'idle' | 'running' | 'gated' | 'stopped' | 'completed' | 'error';
  currentRound: number;
  rounds: LoopRoundResult[];
  startedAt?: string;
  stopReason?: string;
}

export const listLoops = () => request<{ loops: LoopDefinition[] }>('/api/loops');

export const saveLoop = (loop: Partial<LoopDefinition>) =>
  request<{ loop: LoopDefinition }>('/api/loops', {
    method: 'POST',
    body: JSON.stringify(loop),
  });

export const getLoop = (id: string) =>
  request<{ loop: LoopDefinition; progress: LoopProgress | null }>(`/api/loops/${id}`);

export const deleteLoop = (id: string) =>
  request<{ ok: boolean }>(`/api/loops/${id}`, { method: 'DELETE' });

export const startLoop = (id: string) =>
  request<{ progress: LoopProgress }>(`/api/loops/${id}/start`, { method: 'POST' });

export const stopLoop = (id: string) =>
  request<{ progress: LoopProgress }>(`/api/loops/${id}/stop`, { method: 'POST' });

export const advanceLoop = (id: string, action: 'continue' | 'stop') =>
  request<{ progress: LoopProgress }>(`/api/loops/${id}/advance`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });

/* ── Skills ─────────────────────────────────────────────────────────── */

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  body: string;
  source: string;
}

export const listSkills = () => request<{ skills: SkillRecord[] }>('/api/skills');

/* ── Legacy control-plane (agents / providers / executions / memory) ──── */

export interface AgentRecord {
  id: string;
  name: string;
  config: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const listAgents = () => request<{ agents: AgentRecord[] }>('/api/agents');
export const createAgent = (name: string, config?: Record<string, unknown>) =>
  request<{ agent: AgentRecord }>('/api/agents', {
    method: 'POST',
    body: JSON.stringify({ name, config }),
  });
export const deleteAgent = (id: string) =>
  request<{ ok: boolean }>(`/api/agents/${id}`, { method: 'DELETE' });

export interface ProviderRecord {
  id: string;
  name: string;
  type: string;
  endpoint?: string;
  apiKeyConfigured: boolean;
  createdAt: string;
}

export const listProviders = () => request<{ providers: ProviderRecord[] }>('/api/providers');
export const addProvider = (data: Record<string, unknown>) =>
  request<{ provider: ProviderRecord }>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const removeProvider = (id: string) =>
  request<{ ok: boolean }>(`/api/providers/${id}`, { method: 'DELETE' });

export interface ExecutionRecord {
  id: string;
  status: string;
  agentId?: string;
  createdAt: string;
}

export const listExecutions = () => request<{ executions: ExecutionRecord[] }>('/api/executions');
export const startExecution = (data: Record<string, unknown>) =>
  request<{ execution: ExecutionRecord }>('/api/executions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const cancelExecution = (id: string) =>
  request<{ execution: ExecutionRecord }>(`/api/executions/${id}/cancel`, { method: 'POST' });
