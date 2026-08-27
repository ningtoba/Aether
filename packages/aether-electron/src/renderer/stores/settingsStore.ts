import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Type definitions for all settings categories ────────────────

export interface GeneralSettings {
  theme: 'dark' | 'light' | 'system';
  language: string;
  startupBehavior: 'restore' | 'minimized' | 'hidden';
  minimizeToTray: boolean;
  dataDir: string;
  port: number;
  host: string;
}

export interface ProviderSettings {
  apiKeys: Record<string, string>; // provider_id -> masked key
  defaultProvider: string;
  providerPriorities: Record<string, number>;
  fallbackChains: string[]; // ordered provider ids
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    concurrentRequests: number;
  };
  customHeaders: Record<string, string>;
}

export interface OrchestrationSettings {
  maxTurnLoop: number;
  defaultMaxTurns: number;
  autonomousLoopLimit: number;
  graphCheckpointEnabled: boolean;
  checkpointInterval: number;
  maxParallelNodes: number;
  retryPolicy: {
    maxAttempts: number;
    backoff: 'fixed' | 'exponential' | 'linear';
    initialDelay: number;
    maxDelay: number;
  };
}

export interface MemorySettings {
  memoryEnabled: boolean;
  storageType: 'sqlite' | 'qdrant' | 'postgres' | 'memory';
  vectorDbUrl: string;
  collectionName: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingBatchSize: number;
  chunkingStrategy: 'fixed' | 'sentence' | 'paragraph' | 'semantic';
  maxChunkSize: number;
  chunkOverlap: number;
  topK: number;
  minScore: number;
  rerankEnabled: boolean;
  hybridSearchEnabled: boolean;
}

export interface ExecutionSettings {
  maxConcurrent: number;
  defaultTimeout: number;
  maxRetries: number;
  enableParallelSteps: boolean;
  resourceLimits: {
    maxMemoryMB: number;
    maxCPUPercent: number;
    maxDiskMB: number;
  };
  tokenBudgetPerTurn: number;
  contextWindowLimit: number;
}

export interface DockerSettings {
  sandboxEnabled: boolean;
  dockerSocketPath: string;
  defaultImage: string;
  networkMode: 'bridge' | 'host' | 'none';
  memoryLimit: number;
  cpuLimit: number;
  timeout: number;
}

export interface SecuritySettings {
  rbacEnabled: boolean;
  mcpServerEnabled: boolean;
  mcpServers: { id: string; name: string; command: string; args: string[] }[];
  allowedPaths: string[];
  deniedCommands: string[];
  sandboxExecution: boolean;
}

export interface BrowserSettings {
  browserAutomationEnabled: boolean;
  headlessMode: boolean;
  defaultViewport: { width: number; height: number };
  timeout: number;
  screenshotEnabled: boolean;
}

export interface LoggingSettings {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  loggingVerbosity: number;
  tracingEnabled: boolean;
  telemetryEnabled: boolean;
  metricsEnabled: boolean;
  logRetentionDays: number;
}

export interface PluginSettings {
  pluginDir: string;
  autoLoadPlugins: boolean;
  enabledPlugins: string[];
}

export interface DeploymentSettings {
  cicdEnabled: boolean;
  commitSettings: {
    autoCommit: boolean;
    commitMessagePrefix: string;
    signCommits: boolean;
  };
  deploymentTarget: 'local' | 'docker' | 'kubernetes' | 'cloud';
  deploymentUrl: string;
}

export interface EvaluationSettings {
  evalEnabled: boolean;
  evalMetric: 'accuracy' | 'bleu' | 'rouge' | 'custom';
  evalDataset: string;
  evalFrequency: 'manual' | 'per-commit' | 'daily' | 'weekly';
}

export interface GUISettings {
  sidebarCollapsed: boolean;
  fontSize: number;
  compactMode: boolean;
  showTimestamps: boolean;
  showTokenUsage: boolean;
  refreshInterval: number;
}

// ─── Complete Settings Shape ────────────────────────────────────

export interface AllAetherSettings {
  general: GeneralSettings;
  providers: ProviderSettings;
  orchestration: OrchestrationSettings;
  memory: MemorySettings;
  execution: ExecutionSettings;
  docker: DockerSettings;
  security: SecuritySettings;
  browser: BrowserSettings;
  logging: LoggingSettings;
  plugins: PluginSettings;
  deployment: DeploymentSettings;
  evaluation: EvaluationSettings;
  gui: GUISettings;
}

// ─── Defaults ───────────────────────────────────────────────────

/** Default settings snapshot (also used as the rehydrate base). */
export const DEFAULT_SETTINGS: AllAetherSettings = {
  general: {
    theme: 'dark',
    language: 'en',
    startupBehavior: 'restore',
    minimizeToTray: true,
    dataDir: './data',
    port: 8456,
    host: '127.0.0.1',
  },
  providers: {
    apiKeys: {},
    defaultProvider: 'openai',
    providerPriorities: { openai: 1, anthropic: 2, ollama: 3 },
    fallbackChains: ['openai', 'anthropic'],
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 100000,
      concurrentRequests: 5,
    },
    customHeaders: {},
  },
  orchestration: {
    maxTurnLoop: 100,
    defaultMaxTurns: 25,
    autonomousLoopLimit: 50,
    graphCheckpointEnabled: true,
    checkpointInterval: 30,
    maxParallelNodes: 4,
    retryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelay: 1000,
      maxDelay: 30000,
    },
  },
  memory: {
    memoryEnabled: true,
    storageType: 'sqlite',
    vectorDbUrl: '',
    collectionName: 'aether_memories',
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-ada-002',
    embeddingDimension: 1536,
    embeddingBatchSize: 20,
    chunkingStrategy: 'sentence',
    maxChunkSize: 1000,
    chunkOverlap: 200,
    topK: 10,
    minScore: 0.7,
    rerankEnabled: false,
    hybridSearchEnabled: false,
  },
  execution: {
    maxConcurrent: 8,
    defaultTimeout: 300,
    maxRetries: 3,
    enableParallelSteps: true,
    resourceLimits: {
      maxMemoryMB: 1024,
      maxCPUPercent: 80,
      maxDiskMB: 500,
    },
    tokenBudgetPerTurn: 8192,
    contextWindowLimit: 128000,
  },
  docker: {
    sandboxEnabled: false,
    dockerSocketPath: '/var/run/docker.sock',
    defaultImage: 'aether-sandbox:latest',
    networkMode: 'bridge',
    memoryLimit: 512,
    cpuLimit: 2,
    timeout: 600,
  },
  security: {
    rbacEnabled: false,
    mcpServerEnabled: false,
    mcpServers: [],
    allowedPaths: ['/home', '/tmp'],
    deniedCommands: ['rm -rf', 'shutdown', 'reboot'],
    sandboxExecution: true,
  },
  browser: {
    browserAutomationEnabled: true,
    headlessMode: true,
    defaultViewport: { width: 1280, height: 720 },
    timeout: 30000,
    screenshotEnabled: true,
  },
  logging: {
    logLevel: 'info',
    loggingVerbosity: 3,
    tracingEnabled: false,
    telemetryEnabled: false,
    metricsEnabled: true,
    logRetentionDays: 30,
  },
  plugins: {
    pluginDir: './plugins',
    autoLoadPlugins: true,
    enabledPlugins: [],
  },
  deployment: {
    cicdEnabled: false,
    commitSettings: {
      autoCommit: false,
      commitMessagePrefix: 'aether:',
      signCommits: false,
    },
    deploymentTarget: 'local',
    deploymentUrl: '',
  },
  evaluation: {
    evalEnabled: false,
    evalMetric: 'accuracy',
    evalDataset: '',
    evalFrequency: 'manual',
  },
  gui: {
    sidebarCollapsed: false,
    fontSize: 14,
    compactMode: false,
    showTimestamps: true,
    showTokenUsage: true,
    refreshInterval: 5000,
  },
};

// ─── Store ──────────────────────────────────────────────────────

interface SettingsStore {
  settings: AllAetherSettings;
  isDirty: boolean;
  updateGeneral: (patch: Partial<GeneralSettings>) => void;
  updateProviders: (patch: Partial<ProviderSettings>) => void;
  updateOrchestration: (patch: Partial<OrchestrationSettings>) => void;
  updateMemory: (patch: Partial<MemorySettings>) => void;
  updateExecution: (patch: Partial<ExecutionSettings>) => void;
  updateDocker: (patch: Partial<DockerSettings>) => void;
  updateSecurity: (patch: Partial<SecuritySettings>) => void;
  updateBrowser: (patch: Partial<BrowserSettings>) => void;
  updateLogging: (patch: Partial<LoggingSettings>) => void;
  updatePlugins: (patch: Partial<PluginSettings>) => void;
  updateDeployment: (patch: Partial<DeploymentSettings>) => void;
  updateEvaluation: (patch: Partial<EvaluationSettings>) => void;
  updateGUI: (patch: Partial<GUISettings>) => void;
  resetCategory: (category: keyof AllAetherSettings) => void;
  resetAll: () => void;
  saveSettings: () => void;
}

/**
 * Strip secrets from a settings snapshot before it is persisted. Provider
 * API keys and custom auth headers must never be written to localStorage/
 * disk; they live only in the in-memory store for the current session.
 * Exported so the sanitizer is unit-testable.
 */
export function sanitizePersistedSettings(state: { settings: AllAetherSettings }): {
  settings: AllAetherSettings;
} {
  // Empty the secret fields (keeping the shape) so a shallow persist-rehydrate
  // merge can never leave providers.apiKeys / customHeaders undefined — the
  // Settings page iterates those objects and would crash on undefined.
  return {
    settings: {
      ...state.settings,
      providers: {
        ...state.settings.providers,
        apiKeys: {},
        customHeaders: {},
      },
    },
  };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      isDirty: false,

      updateGeneral: (patch) =>
        set((state) => ({
          settings: { ...state.settings, general: { ...state.settings.general, ...patch } },
          isDirty: true,
        })),

      updateProviders: (patch) =>
        set((state) => ({
          settings: { ...state.settings, providers: { ...state.settings.providers, ...patch } },
          isDirty: true,
        })),

      updateOrchestration: (patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            orchestration: { ...state.settings.orchestration, ...patch },
          },
          isDirty: true,
        })),

      updateMemory: (patch) =>
        set((state) => ({
          settings: { ...state.settings, memory: { ...state.settings.memory, ...patch } },
          isDirty: true,
        })),

      updateExecution: (patch) =>
        set((state) => ({
          settings: { ...state.settings, execution: { ...state.settings.execution, ...patch } },
          isDirty: true,
        })),

      updateDocker: (patch) =>
        set((state) => ({
          settings: { ...state.settings, docker: { ...state.settings.docker, ...patch } },
          isDirty: true,
        })),

      updateSecurity: (patch) =>
        set((state) => ({
          settings: { ...state.settings, security: { ...state.settings.security, ...patch } },
          isDirty: true,
        })),

      updateBrowser: (patch) =>
        set((state) => ({
          settings: { ...state.settings, browser: { ...state.settings.browser, ...patch } },
          isDirty: true,
        })),

      updateLogging: (patch) =>
        set((state) => ({
          settings: { ...state.settings, logging: { ...state.settings.logging, ...patch } },
          isDirty: true,
        })),

      updatePlugins: (patch) =>
        set((state) => ({
          settings: { ...state.settings, plugins: { ...state.settings.plugins, ...patch } },
          isDirty: true,
        })),

      updateDeployment: (patch) =>
        set((state) => ({
          settings: { ...state.settings, deployment: { ...state.settings.deployment, ...patch } },
          isDirty: true,
        })),

      updateEvaluation: (patch) =>
        set((state) => ({
          settings: { ...state.settings, evaluation: { ...state.settings.evaluation, ...patch } },
          isDirty: true,
        })),

      updateGUI: (patch) =>
        set((state) => ({
          settings: { ...state.settings, gui: { ...state.settings.gui, ...patch } },
          isDirty: true,
        })),

      resetCategory: (category) =>
        set((state) => ({
          settings: { ...state.settings, [category]: { ...DEFAULT_SETTINGS[category] } },
          isDirty: true,
        })),

      resetAll: () => set({ settings: { ...DEFAULT_SETTINGS }, isDirty: true }),

      saveSettings: () => set({ isDirty: false }),
    }),
    {
      name: 'aether-settings',
      partialize: (state) => sanitizePersistedSettings(state),
      onRehydrateStorage: () => (state) => {
        if (state) state.isDirty = false;
      },
    },
  ),
);
