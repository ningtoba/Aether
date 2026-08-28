/**
 * In-memory data store for agents and entities
 */

/** Simple agent ID type */
export type AgentId = string & { __brand: 'AgentId' };

/** Simple agent status */
export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'stopped';

/** Agent configuration */
export interface AgentConfig {
  name?: string;
  description?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface AgentRecord {
  id: AgentId;
  name: string;
  config: AgentConfig;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
}

const agents = new Map<AgentId, AgentRecord>();

export function listAgents(): AgentRecord[] {
  return Array.from(agents.values());
}

export function getAgent(id: AgentId): AgentRecord | undefined {
  return agents.get(id);
}

export function createAgent(data: { name: string; config?: Partial<AgentConfig> }): AgentRecord {
  const id = crypto.randomUUID() as AgentId;
  const now = new Date().toISOString();
  const record: AgentRecord = {
    id,
    name: data.name,
    config: (data.config ?? {}) as AgentConfig,
    status: 'idle' as AgentStatus,
    createdAt: now,
    updatedAt: now,
  };
  agents.set(id, record);
  return record;
}

export function updateAgent(id: AgentId, data: Partial<AgentRecord>): AgentRecord | undefined {
  const existing = agents.get(id);
  if (!existing) return undefined;
  const updated: AgentRecord = {
    ...existing,
    ...data,
    // A partial config patch must merge with the existing config; a raw
    // spread would silently drop every other key (model, temperature, …).
    config: data.config ? ({ ...existing.config, ...data.config } as AgentConfig) : existing.config,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  agents.set(id, updated);
  return updated;
}

export function deleteAgent(id: AgentId): boolean {
  return agents.delete(id);
}
