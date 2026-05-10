/**
 * IPC handlers for Aether Desktop
 *
 * Bridges renderer <-> main process for backend operations.
 */

import { ipcMain } from "electron";

interface HealthResponse {
  status: "ok" | "error";
  version: string;
}

export function registerIpcHandlers(): void {
  // ── System Info ────────────────────────────────────────────────

  ipcMain.handle("system:health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      version: "0.1.0",
    };
  });

  ipcMain.handle("system:platform", () => {
    return {
      platform: process.platform,
      arch: process.arch,
    };
  });

  // ── Backend Proxy ──────────────────────────────────────────────
  // In a full setup these would proxy to the running backend server.

  ipcMain.handle("backend:status", async () => {
    // TODO: check actual backend process health
    return { running: false };
  });

  ipcMain.handle("backend:start", async () => {
    // TODO: spawn backend process
    return { success: true };
  });

  ipcMain.handle("backend:stop", async () => {
    // TODO: gracefully stop backend
    return { success: true };
  });

  // ── Window Controls ────────────────────────────────────────────

  ipcMain.on("window:minimize", (event: Electron.IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on("window:maximize", (event: Electron.IpcMainEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on("window:close", (event: Electron.IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

// Needed for BrowserWindow reference
import { BrowserWindow } from "electron";
