import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── App / System ──
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  getGpuInfo: () => ipcRenderer.invoke('gpu:get-info'),
  quitApp: () => ipcRenderer.send('app:quit'),
  minimizeToTray: () => ipcRenderer.send('app:minimize-to-tray'),
  openExternal: (url: string) => ipcRenderer.send('system:open-external', url),

  // ── Window management ──
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  getIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleFullscreen: () => ipcRenderer.send('window:fullscreen'),

  // ── Update events (main → renderer) ──
  onUpdateAvailable: (cb: (status: { available: boolean; version?: string; releaseDate?: string; releaseNotes?: string; downloadProgress?: number; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => cb(status);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateDownloading: (cb: (progress: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: number) => cb(progress);
    ipcRenderer.on('update:downloading', handler);
    return () => ipcRenderer.removeListener('update:downloading', handler);
  },
  onUpdateDownloaded: (cb: (status: { available: boolean; version?: string; releaseDate?: string; releaseNotes?: string; downloadProgress?: number; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => cb(status);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateError: (cb: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => cb(error);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },

  // ── Window events (main → renderer) ──
  onMaximizeChange: (cb: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized);
    ipcRenderer.on('window:maximize-changed', handler);
    return () => ipcRenderer.removeListener('window:maximize-changed', handler);
  },

  // ── Platform info ──
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
