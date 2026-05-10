import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  nativeImage,
} from 'electron';
import path from 'node:path';
import { registerAutoUpdater } from './auto-updater';
import { registerCrashReporter } from './crash-reporter';
import { createTray, destroyTray } from './tray';
import { IPC_CHANNELS, type SystemInfo } from '../shared/ipc-protocol';

/* ─── Constants ──────────────────────────────────────────────────────── */

const isDev = !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

/* ─── Window creation ────────────────────────────────────────────────── */

function createMainWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: Math.min(1400, Math.round(screenWidth * 0.8)),
    height: Math.min(900, Math.round(screenHeight * 0.85)),
    minWidth: 800,
    minHeight: 600,
    show: false, // show after ready-to-show to avoid white flash
    backgroundColor: '#0f0f11',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for preload to access Node APIs
    },
  });

  /* GPU acceleration — enable Chromium GPU features */
  if (app.commandLine.hasSwitch('disable-gpu')) {
    app.commandLine.appendSwitch('disable-gpu');
  } else {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
  }

  /* Load content */
  if (isDev) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  /* Show window once content is ready — avoids flash */
  win.once('ready-to-show', () => {
    win.show();
    if (!isDev) {
      win.focus();
    }
  });

  /* Minimize instead of close on non-macOS */
  win.on('close', (event) => {
    if ((app as any).isQuitting) {
      return;
    }
    event.preventDefault();
    win.hide();
  });

  /* Track maximize state for IPC queries */
  win.on('maximize', () => {
    win.webContents.send('window:maximize-changed', true);
  });
  win.on('unmaximize', () => {
    win.webContents.send('window:maximize-changed', false);
  });

  mainWindow = win;
  return win;
}

/* ─── IPC handler registration ───────────────────────────────────────── */

function registerIpcHandlers(): void {
  /* App lifecycle */
  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => app.getVersion());
  ipcMain.handle(IPC_CHANNELS.GET_PLATFORM, () => process.platform);
  ipcMain.on(IPC_CHANNELS.QUIT_APP, () => app.quit());
  ipcMain.on(IPC_CHANNELS.MINIMIZE_TO_TRAY, () => {
    mainWindow?.hide();
  });

  /* Window management */
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
  });
  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false;
  });
  ipcMain.on(IPC_CHANNELS.WINDOW_FULLSCREEN, () => {
    mainWindow?.setFullScreen(!mainWindow?.isFullScreen());
  });

  /* System info */
  ipcMain.handle(IPC_CHANNELS.GET_SYSTEM_INFO, async (): Promise<SystemInfo> => {
    const os = await import('node:os');
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      cpuCores: os.cpus().length,
      totalMemoryGB: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      freeMemoryGB: Math.round((os.freemem() / 1024 / 1024 / 1024) * 10) / 10,
    };
  });

  ipcMain.on(IPC_CHANNELS.OPEN_EXTERNAL, (_event, url: string) => {
    import('electron').then(({ shell }) => {
      shell.openExternal(url);
    });
  });

  /* GPU info */
  ipcMain.handle(IPC_CHANNELS.GET_GPU_INFO, async () => {
    try {
      const gpuInfo = await app.getGPUInfo('basic');
      return {
        vendor: gpuInfo?.gpuDevice?.[0]?.vendorId
          ? `0x${gpuInfo.gpuDevice[0].vendorId.toString(16)}`
          : 'unknown',
        model: gpuInfo?.gpuDevice?.[0]?.deviceName ?? 'unknown',
        featureLevel: gpuInfo?.gpuDevice?.[0]?.driverVersion
          ? parseFloat(gpuInfo.gpuDevice[0].driverVersion) || 0
          : 0,
        dedicatedMemoryMB: gpuInfo?.gpuDevice?.[0]?.dedicatedVideoMemory ?? 0,
        isIntegrated: gpuInfo?.gpuDevice?.[0]?.isIntegrated ?? false,
      };
    } catch {
      return null;
    }
  });

  /* Tray IPC — proxied from preload */
  ipcMain.on(IPC_CHANNELS.TRAY_SHOW_WINDOW, () => {
    showMainWindow();
  });
  ipcMain.on(IPC_CHANNELS.TRAY_QUIT, () => {
    app.quit();
  });
}

/* ─── Window helpers ─────────────────────────────────────────────────── */

function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/* ─── Single-instance lock ───────────────────────────────────────────── */

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

/* ─── App lifecycle ──────────────────────────────────────────────────── */

app.whenReady().then(() => {
  /* Register all IPC handlers */
  registerIpcHandlers();

  /* Register sub-modules */
  registerAutoUpdater({ getMainWindow });
  registerCrashReporter({ getMainWindow });

  /* Create the main window */
  createMainWindow();

  /* Create system tray */
  createTray({ showMainWindow, getMainWindow });

  /* macOS: re-create window on activate */
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    destroyTray();
    app.quit();
  }
});

app.on('before-quit', () => {
  destroyTray();
});
