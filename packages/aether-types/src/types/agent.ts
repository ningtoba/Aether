/** Agent identification - branded string type */
export type AgentId = string & { readonly __brand: "AgentId" };

/** Possible states for an agent's execution lifecycle */
export type AgentStatus = 
  | "idle" 
  | "running" 
  | "error" 
  | "completed" 
  | "paused";

/** Configuration for creating or running an agent */
export interface AgentConfig {
  id: AgentId;
  name: string;
  instructions: string;
  model: string;
  provider: string;
  maxTurns: number;
  tools: string[];
  memory: boolean;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

/** Runtime snapshot of an agent's execution state */
export interface AgentExecutionState {
  status: AgentStatus;
  currentTask?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  turnCount: number;
  tokenCount: number;
}

/** Agent role within the hierarchical architecture */
export type AgentRole = 
  | "executive" 
  | "architect" 
  | "worker" 
  | "verifier";

/** Agent registration payload for the agent registry */
export interface AgentRegistration {
  id: AgentId;
  role: AgentRole;
  config: AgentConfig;
  createdAt: number;
  lastUsed?: number;
}
