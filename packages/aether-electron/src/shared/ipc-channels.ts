/**
 * Aether — IPC channel constants
 *
 * All inter-process communication channels between main and renderer
 * are defined here to prevent string typos across the stack.
 */

export const IpcChannels = {
  // ── App / System ──────────────────────────────────────────────
  /** Get app version string */
  GET_APP_VERSION: 'app:get-version',
  /** Get platform info */
  GET_PLATFORM: 'app:get-platform',

  // ── Auto-update ───────────────────────────────────────────────
  /** Renderer → Main: ask the updater to check now */
  CHECK_FOR_UPDATES: 'update:check',
  /** Main → Renderer: no update available */
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  /** Main → Renderer: update available with version info */
  UPDATE_AVAILABLE: 'update:available',
  /** Main → Renderer: download progress { percent, bytesPerSecond } */
  UPDATE_DOWNLOAD_PROGRESS: 'update:download-progress',
  /** Main → Renderer: download completed, ready to install */
  UPDATE_DOWNLOADED: 'update:downloaded',
  /** Renderer → Main: install the downloaded update now */
  INSTALL_UPDATE: 'update:install',
  /** Renderer → Main: user dismissed the update (postpone) */
  DISMISS_UPDATE: 'update:dismiss',
  /** Main → Renderer: update error */
  UPDATE_ERROR: 'update:error',

  // ── Window management ─────────────────────────────────────────
  /** Renderer → Main: minimize window */
  MINIMIZE_WINDOW: 'window:minimize',
  /** Renderer → Main: maximize / unmaximize window */
  MAXIMIZE_WINDOW: 'window:maximize',
  /** Renderer → Main: close window */
  CLOSE_WINDOW: 'window:close',

  // ── Backend / Headless ────────────────────────────────────────
  /** Renderer → Main: get backend server URL */
  GET_BACKEND_URL: 'backend:get-url',
  /** Main → Renderer: backend URL changed */
  BACKEND_URL_CHANGED: 'backend:url-changed',

  // ── Deep links ────────────────────────────────────────────────
  /** Main → Renderer: deep link received on second-instance */
  DEEP_LINK: 'app:deep-link',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
