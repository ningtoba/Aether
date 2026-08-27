/**
 * IPC handlers for Aether Desktop
 *
 * Bridges renderer <-> main process for backend operations.
 * Each handler delegates to the backend-bridge module.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as bridge from './backend-bridge.js';

export function registerIpcHandlers(): void {
  // ── System Info ────────────────────────────────────────────────

  ipcMain.handle('system:health', async (): Promise<{ status: string; version: string }> => {
    const health = bridge.getSystemHealth();
    return {
      status: health.status,
      version: health.version,
    };
  });

  ipcMain.handle('system:platform', () => {
    return {
      platform: process.platform,
      arch: process.arch,
    };
  });

  // ── Backend Health ─────────────────────────────────────────────

  ipcMain.handle('backend:health', async () => {
    return bridge.getSystemHealth();
  });

  ipcMain.handle('backend:status', async () => {
    return { running: true };
  });

  ipcMain.handle('backend:start', async () => {
    return { success: true };
  });

  ipcMain.handle('backend:stop', async () => {
    return { success: true };
  });

  // ── Agents ─────────────────────────────────────────────────────

  ipcMain.handle('agents:list', async () => {
    return { agents: bridge.listAgents() };
  });

  ipcMain.handle('agents:get', async (_event, id: string) => {
    const agent = bridge.getAgent(id);
    if (!agent) return { error: 'Agent not found' };
    return { agent };
  });

  ipcMain.handle(
    'agents:create',
    async (
      _event,
      data: {
        name: string;
        model?: string;
        description?: string;
        config?: Record<string, unknown>;
      },
    ) => {
      const agent = bridge.createAgent(data);
      return { agent };
    },
  );

  ipcMain.handle('agents:update', async (_event, id: string, data: Record<string, unknown>) => {
    const agent = bridge.updateAgent(id, data);
    if (!agent) return { error: 'Agent not found' };
    return { agent };
  });

  ipcMain.handle('agents:delete', async (_event, id: string) => {
    const deleted = bridge.deleteAgent(id);
    if (!deleted) return { error: 'Agent not found' };
    return { success: true };
  });

  // ── Providers ──────────────────────────────────────────────────

  ipcMain.handle('providers:list', async () => {
    return { providers: bridge.listProviders() };
  });

  ipcMain.handle(
    'providers:add',
    async (
      _event,
      data: {
        name: string;
        type: string;
        endpoint?: string;
        apiKey?: string;
        defaultModel?: string;
        models?: unknown[];
      },
    ) => {
      const provider = bridge.addProvider(data as any);
      return { provider };
    },
  );

  ipcMain.handle('providers:health', async (_event, id: string) => {
    const health = bridge.checkProviderHealth(id);
    if (!health) return { error: 'Provider not found' };
    return { health };
  });

  ipcMain.handle('providers:remove', async (_event, id: string) => {
    const deleted = bridge.removeProvider(id);
    if (!deleted) return { error: 'Provider not found' };
    return { success: true };
  });

  // ── Executions ─────────────────────────────────────────────────

  ipcMain.handle('executions:list', async () => {
    return { executions: bridge.listExecutions() };
  });

  ipcMain.handle('executions:get', async (_event, id: string) => {
    const execution = bridge.getExecution(id);
    if (!execution) return { error: 'Execution not found' };
    return { execution };
  });

  ipcMain.handle(
    'executions:start',
    async (_event, data: { agentId?: string; plan?: Record<string, unknown>; input?: unknown }) => {
      const execution = bridge.startExecution(data);
      return { execution };
    },
  );

  ipcMain.handle('executions:cancel', async (_event, id: string) => {
    const execution = bridge.cancelExecution(id);
    if (!execution) return { error: 'Execution not found' };
    return { execution };
  });

  // ── Plugins ────────────────────────────────────────────────────

  ipcMain.handle('plugins:list', async () => {
    return { plugins: bridge.listPlugins() };
  });

  ipcMain.handle(
    'plugins:install',
    async (
      _event,
      data: {
        name: string;
        version?: string;
        description?: string;
        author?: string;
        type?: string;
      },
    ) => {
      const plugin = bridge.installPlugin(data);
      return { plugin };
    },
  );

  ipcMain.handle('plugins:uninstall', async (_event, id: string) => {
    const deleted = bridge.uninstallPlugin(id);
    if (!deleted) return { error: 'Plugin not found' };
    return { success: true };
  });

  // ── Memory ─────────────────────────────────────────────────────

  ipcMain.handle('memory:stats', async () => {
    return bridge.getMemoryStats();
  });

  ipcMain.handle('memory:search', async (_event, query: string, scope?: string) => {
    return { results: bridge.searchMemory(query, scope) };
  });

  ipcMain.handle('memory:clear', async (_event, type?: string) => {
    bridge.clearMemory(type);
    return { success: true };
  });

  // ── Window Controls ────────────────────────────────────────────

  ipcMain.on('window:minimize', (event: Electron.IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on('window:maximize', (event: Electron.IpcMainEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on('window:close', (event: Electron.IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
