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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
