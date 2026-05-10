/**
 * IPC channel constants — single source of truth for all channel names
 * used between main process and renderer via contextBridge.
 */
export const IpcChannels = {
  // System info
  GET_SYSTEM_INFO: 'system:get-info',
  GET_PLATFORM: 'system:get-platform',
  GET_GPU_INFO: 'system:get-gpu-info',

  // Window management
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_SET_TITLE: 'window:set-title',
  WINDOW_ON_MAXIMIZE_CHANGE: 'window:on-maximize-change',

  // Tray
  TRAY_SET_TITLE: 'tray:set-title',
  TRAY_SHOW_NOTIFICATION: 'tray:show-notification',

  // App lifecycle
  APP_QUIT: 'app:quit',
  APP_RESTART: 'app:restart',
  APP_GET_VERSION: 'app:get-version',
  APP_FOCUS: 'app:focus',

  // Background execution
  BG_START_PROCESS: 'bg:start-process',
  BG_STOP_PROCESS: 'bg:stop-process',
  BG_LIST_PROCESSES: 'bg:list-processes',
  BG_PROCESS_OUTPUT: 'bg:process-output',
  BG_PROCESS_EXIT: 'bg:process-exit',

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_ON_STATUS: 'updater:on-status',
  UPDATER_ON_PROGRESS: 'updater:on-progress',

  // Crash reporting
  CRASH_GET_LOGS: 'crash:get-logs',
  CRASH_REPORT: 'crash:report',
  CRASH_GET_DUMPS: 'crash:get-dumps',
  CRASH_CLEAR_DUMPS: 'crash:clear-dumps',

  // File dialogs
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_SAVE_FILE: 'dialog:save-file',
  DIALOG_OPEN_DIRECTORY: 'dialog:open-directory',

  // Shell / process spawn
  SHELL_EXEC: 'shell:exec',
  SHELL_SPAWN: 'shell:spawn',
  SHELL_KILL: 'shell:kill',
  SHELL_OUTPUT: 'shell:output',
  SHELL_EXIT: 'shell:exit',

  // Notifications
  NOTIFICATION_SHOW: 'notification:show',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

// ─── Response types ───────────────────────────────────────────────────

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  osVersion: string;
  hostname: string;
  totalMemory: number;
  freeMemory: number;
  cpuCores: number;
  cpuModel: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
}

export interface GpuInfo {
  vendor: string;
  model: string;
  deviceId: number;
  vendorId: number;
  subsysId: number;
  revision: number;
  gpuFeatureStatus?: Record<string, string>;
}

export interface BackgroundProcess {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  pid: number | null;
  running: boolean;
  startedAt: number;
  exitCode: number | null;
}

export interface BackgroundProcessOutput {
  processId: string;
  data: string;
}

export interface BackgroundProcessExit {
  processId: string;
  exitCode: number | null;
  signal: string | null;
}

export interface UpdateStatus {
  available: boolean;
  version?: string;
  downloaded: boolean;
  error?: string;
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface CrashLogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  stack?: string;
  path?: string;
}

export interface CrashReport {
  id: string;
  timestamp: string;
  error: string;
  stack: string;
  appVersion: string;
  systemInfo: string;
}

export interface ShellProcessOutput {
  processId: string;
  data: string;
  stream: 'stdout' | 'stderr';
}

export interface ShellProcessExit {
  processId: string;
  exitCode: number | null;
}

// ─── IPC event payloads ──────────────────────────────────────────────

export interface IpcEvents {
  'window:maximize-change': boolean;
  'bg:process-output': BackgroundProcessOutput;
  'bg:process-exit': BackgroundProcessExit;
  'updater:status': UpdateStatus;
  'updater:progress': UpdateProgress;
  'shell:output': ShellProcessOutput;
  'shell:exit': ShellProcessExit;
}

// ─── Electron API exposed to renderer via contextBridge ──────────────

export interface ElectronApi {
  // Invoke (request → response)
  getSystemInfo(): Promise<SystemInfo>;
  getPlatform(): Promise<string>;
  getGpuInfo(): Promise<GpuInfo>;
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  isMaximized(): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  appQuit(): Promise<void>;
  appRestart(): Promise<void>;
  appGetVersion(): Promise<string>;
  appFocus(): Promise<void>;
  openFileDialog(options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  saveFileDialog(options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  openDirectoryDialog(): Promise<string | null>;
  showNotification(title: string, body: string): Promise<void>;

  // Background processes
  startBackgroundProcess(label: string, command: string, cwd?: string): Promise<string>;
  stopBackgroundProcess(id: string): Promise<void>;
  listBackgroundProcesses(): Promise<BackgroundProcess[]>;

  // Shell exec
  shellExec(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  shellSpawn(command: string, args: string[], cwd?: string): Promise<string>;
  shellKill(processId: string): Promise<void>;

  // Updater
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;

  // Crash reporting
  getCrashLogs(): Promise<CrashLogEntry[]>;
  reportCrash(error: string, stack: string): Promise<string>;
  getCrashDumps(): Promise<CrashLogEntry[]>;
  clearCrashDumps(): Promise<void>;

  // Events (renderer subscribes to these)
  on(channel: string, callback: (...args: unknown[]) => void): () => void;
  off(channel: string, callback: (...args: unknown[]) => void): void;
}

// Augment the global Window interface for type-safe access
declare global {
  interface Window {
    electron?: ElectronApi;
  }
}
