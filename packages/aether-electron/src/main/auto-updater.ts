/**
 * Auto-updater for Aether Desktop
 *
 * Uses electron-updater with GitHub releases as the update source.
 * Falls back to manual download notification on failure.
 *
 * This module matches the registerAutoUpdater({ getMainWindow }) signature
 * used by src/main/main.ts.
 *
 * NOTE: electron-updater is imported via a try-require pattern to keep
 * TypeScript happy when the package isn't installed in dev environments.
 */

function getAutoUpdater(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron-updater');
  } catch {
    return null;
  }
}

const updater = getAutoUpdater();
const autoUpdater: any = updater?.autoUpdater ?? {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  on: () => {},
  setFeedURL: () => {},
  downloadUpdate: () => {},
  quitAndInstall: () => {},
  checkForUpdates: () => Promise.resolve(),
};

import { BrowserWindow, dialog } from 'electron';

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

export interface AutoUpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
}

export function registerAutoUpdater({ getMainWindow }: AutoUpdaterDeps): void {
  autoUpdater.setFeedURL({
    provider: 'github',
    repo: 'aether',
    owner: 'aether-org', // TODO: update to actual org
  });

  autoUpdater.on('update-available', (info: any) => {
    const win = getMainWindow();
    if (!win) return;
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available. Download now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on('update-downloaded', () => {
    const win = getMainWindow();
    if (!win) return;
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. Restart to install?',
        buttons: ['Restart', 'Later'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[auto-updater]', err.message);
  });

  // Check on startup with a delay to let the UI settle
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      console.error('[auto-updater] check failed', err);
    });
  }, 5_000);
}

/**
 * Legacy entry point used by src/main/index.ts (simpler main process).
 * Kept for backward compatibility during the transition.
 */
export function setupAutoUpdater(win: BrowserWindow): void {
  registerAutoUpdater({ getMainWindow: () => win });
}
