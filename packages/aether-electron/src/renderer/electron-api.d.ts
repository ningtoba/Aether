/**
 * Type declarations for the Electron contextBridge API available
 * to the renderer process via `window.electronAPI`.
 */

interface SystemInfo {
  platform: string;
  arch: string;
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  cpuCores: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  gpu?: GpuInfo;
}

interface GpuInfo {
  vendor: string;
  model: string;
  featureLevel: number;
  dedicatedMemoryMB: number;
  isIntegrated: boolean;
}

interface UpdateStatus {
  available: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  error?: string;
}

/* ─── Backend data types ─────────────────────────────── */

interface AgentRecord {
  id: string;
  name: string;
  model?: string;
  description?: string;
  config?: Record<string, unknown>;
  status: 'idle' | 'running' | 'paused' | 'error' | 'stopped';
  lastRun?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderRecord {
  id: string;
  name: string;
  type: string;
  endpoint?: string;
  apiKeyConfigured: boolean;
  status?: 'connected' | 'disconnected' | 'error' | 'unknown';
  defaultModel?: string;
  models?: Array<{ name: string; contextWindow: number; capabilities: string[] }>;
  createdAt: string;
}

interface ProviderHealthResult {
  id: string;
  name: string;
  status: 'reachable' | 'unreachable' | 'error';
  latency: number;
  checkedAt: string;
}

interface ExecutionRecord {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  agentId?: string;
  plan?: Record<string, unknown>;
  input?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  installedAt: string;
}

interface MemoryStats {
  type: string;
  documentCount: number;
  indexSizeKB: number;
  dimensionCount: number;
  status: 'connected' | 'disconnected' | 'error';
}

interface MemorySearchResult {
  id: string;
  content: string;
  score: number;
  scope: string;
  metadata?: Record<string, unknown>;
}

interface BackendHealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  agentCount: number;
  providerCount: number;
  executionCount: number;
  timestamp: string;
  memory?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
}

interface ElectronAPI {
  // ── App / System ──
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  getSystemInfo: () => Promise<SystemInfo>;
  getGpuInfo: () => Promise<GpuInfo | null>;
  quitApp: () => void;
  minimizeToTray: () => void;
  openExternal: (url: string) => void;

  // ── Window management ──
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  getIsMaximized: () => Promise<boolean>;
  toggleFullscreen: () => void;

  // ── Backend Health ──
  getBackendHealth: () => Promise<BackendHealthStatus>;

  // ── Agents ──
  listAgents: () => Promise<{ agents: AgentRecord[] }>;
  getAgent: (id: string) => Promise<{ agent: AgentRecord } | { error: string }>;
  createAgent: (data: {
    name: string;
    model?: string;
    description?: string;
    config?: Record<string, unknown>;
  }) => Promise<{ agent: AgentRecord }>;
  updateAgent: (
    id: string,
    data: Record<string, unknown>,
  ) => Promise<{ agent: AgentRecord } | { error: string }>;
  deleteAgent: (id: string) => Promise<{ success: boolean } | { error: string }>;

  // ── Providers ──
  listProviders: () => Promise<{ providers: ProviderRecord[] }>;
  addProvider: (data: {
    name: string;
    type: string;
    endpoint?: string;
    apiKey?: string;
    defaultModel?: string;
    models?: unknown[];
  }) => Promise<{ provider: ProviderRecord }>;
  checkProviderHealth: (
    id: string,
  ) => Promise<{ health: ProviderHealthResult } | { error: string }>;
  removeProvider: (id: string) => Promise<{ success: boolean } | { error: string }>;

  // ── Executions ──
  listExecutions: () => Promise<{ executions: ExecutionRecord[] }>;
  getExecution: (id: string) => Promise<{ execution: ExecutionRecord } | { error: string }>;
  startExecution: (data: {
    agentId?: string;
    plan?: Record<string, unknown>;
    input?: unknown;
  }) => Promise<{ execution: ExecutionRecord }>;
  cancelExecution: (id: string) => Promise<{ execution: ExecutionRecord } | { error: string }>;

  // ── Plugins ──
  listPlugins: () => Promise<{ plugins: PluginRecord[] }>;
  installPlugin: (data: {
    name: string;
    version?: string;
    description?: string;
    author?: string;
    type?: string;
  }) => Promise<{ plugin: PluginRecord }>;
  uninstallPlugin: (id: string) => Promise<{ success: boolean } | { error: string }>;

  // ── Memory ──
  getMemoryStats: () => Promise<MemoryStats>;
  searchMemory: (query: string, scope?: string) => Promise<{ results: MemorySearchResult[] }>;
  clearMemory: (type?: string) => Promise<{ success: boolean }>;

  // ── Update events ──
  onUpdateAvailable: (cb: (status: UpdateStatus) => void) => () => void;
  onUpdateDownloading: (cb: (progress: number) => void) => () => void;
  onUpdateDownloaded: (cb: (status: UpdateStatus) => void) => () => void;
  onUpdateError: (cb: (error: string) => void) => () => void;

  // ── Window events ──
  onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;

  // ── Platform info ──
  platform: string;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
}

export {};

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
