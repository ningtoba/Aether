/** Global application settings */
export interface AppSettings {
  theme: "light" | "dark" | "system";
  language: string;
  logLevel: "debug" | "info" | "warn" | "error";
  autoUpdate: boolean;
  telemetry: boolean;
  dataDir: string;
  port: number;
  host: string;
}

/** Frontend-specific UI settings */
export interface GUISettings {
  sidebarCollapsed: boolean;
  fontSize: number;
  compactMode: boolean;
  showTimestamps: boolean;
  showTokenUsage: boolean;
  refreshInterval: number;
}

/** All settings grouped by category */
export interface AllSettings {
  app: AppSettings;
  gui: GUISettings;
  execution: import("./execution").ExecutionConfig;
  memory: import("./memory").RAGConfig;
}
