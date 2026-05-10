/**
 * IPC Protocol — typed contract between main process and renderer.
 * All channels and message shapes are defined here for type safety
 * across the contextBridge boundary.
 */

/* ─── Channel names ──────────────────────────────────────────────────── */

export const IPC_CHANNELS = {
  /* App lifecycle */
  GET_APP_VERSION: 'app:get-version',
  GET_PLATFORM: 'app:get-platform',
  QUIT_APP: 'app:quit',
  MINIMIZE_TO_TRAY: 'app:minimize-to-tray',

  /* Window management */
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_FULLSCREEN: 'window:fullscreen',

  /* Tray */
  TRAY_SHOW_WINDOW: 'tray:show-window',
  TRAY_QUIT: 'tray:quit',

  /* Auto-updater */
  UPDATE_CHECKING: 'update:checking',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_DOWNLOADING: 'update:downloading',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',
  CHECK_FOR_UPDATES: 'update:check',
  INSTALL_UPDATE: 'update:install',

  /* Crash / diagnostics */
  CRASH_LOG: 'crash:log',
  GET_LOGS: 'crash:get-logs',
  REPORT_CRASH: 'crash:report',

  /* System */
  GET_SYSTEM_INFO: 'system:get-info',
  OPEN_EXTERNAL: 'system:open-external',

  /* GPU */
  GET_GPU_INFO: 'gpu:get-info',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/* ─── Request / response shapes ──────────────────────────────────────── */

export interface SystemInfo {
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

export interface GpuInfo {
  vendor: string;
  model: string;
  featureLevel: number;
  dedicatedMemoryMB: number;
  isIntegrated: boolean;
}

export interface UpdateStatus {
  available: boolean;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadProgress?: number; // 0–100
  error?: string;
}

export interface CrashReport {
  timestamp: string;
  type: 'uncaught-exception' | 'unhandled-rejection' | 'renderer-crash' | 'gpu-crash' | 'manual';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/* ─── IPC handler signatures ─────────────────────────────────────────── */

export interface IpcHandlers {
  [IPC_CHANNELS.GET_APP_VERSION]: () => string;
  [IPC_CHANNELS.GET_PLATFORM]: () => string;
  [IPC_CHANNELS.QUIT_APP]: () => void;
  [IPC_CHANNELS.MINIMIZE_TO_TRAY]: () => void;

  [IPC_CHANNELS.WINDOW_MINIMIZE]: () => void;
  [IPC_CHANNELS.WINDOW_MAXIMIZE]: () => void;
  [IPC_CHANNELS.WINDOW_CLOSE]: () => void;
  [IPC_CHANNELS.WINDOW_IS_MAXIMIZED]: () => boolean;
  [IPC_CHANNELS.WINDOW_FULLSCREEN]: () => void;

  [IPC_CHANNELS.GET_SYSTEM_INFO]: () => SystemInfo;
  [IPC_CHANNELS.OPEN_EXTERNAL]: (url: string) => void;

  [IPC_CHANNELS.GET_GPU_INFO]: () => GpuInfo | null;

  [IPC_CHANNELS.CHECK_FOR_UPDATES]: () => void;
  [IPC_CHANNELS.INSTALL_UPDATE]: () => void;

  [IPC_CHANNELS.CRASH_LOG]: (report: CrashReport) => void;
  [IPC_CHANNELS.GET_LOGS]: () => CrashReport[];

  [IPC_CHANNELS.TRAY_SHOW_WINDOW]: () => void;
  [IPC_CHANNELS.TRAY_QUIT]: () => void;
}

/* ─── Event channels (main → renderer) ───────────────────────────────── */

export interface IpcEvents {
  [IPC_CHANNELS.UPDATE_CHECKING]: () => void;
  [IPC_CHANNELS.UPDATE_AVAILABLE]: (status: UpdateStatus) => void;
  [IPC_CHANNELS.UPDATE_NOT_AVAILABLE]: () => void;
  [IPC_CHANNELS.UPDATE_DOWNLOADING]: (progress: number) => void;
  [IPC_CHANNELS.UPDATE_DOWNLOADED]: (status: UpdateStatus) => void;
  [IPC_CHANNELS.UPDATE_ERROR]: (error: string) => void;
  [IPC_CHANNELS.CRASH_LOG]: (report: CrashReport) => void;
}
