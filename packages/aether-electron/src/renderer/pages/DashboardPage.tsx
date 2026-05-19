import React, { useEffect, useState } from "react";

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
  gpu?: { vendor: string; model: string; featureLevel: number; dedicatedMemoryMB: number; isIntegrated: boolean };
}

interface AgentCardData {
  name: string;
  model: string;
  status: "idle" | "running" | "error";
  lastActive: string;
  description: string;
}

interface ExecutionRow {
  id: string;
  workflowName: string;
  status: "running" | "completed" | "failed";
  timestamp: string;
  duration: string;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-gray-600",
  running: "bg-emerald-500",
  error: "bg-red-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const STATUS_BG: Record<string, string> = {
  running: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  idle: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

function formatMemoryGB(bytes: number): string {
  return `${bytes.toFixed(1)} GB`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDuration(isoStart: string, isoEnd?: string): string {
  const start = new Date(isoStart).getTime();
  const end = isoEnd ? new Date(isoEnd).getTime() : Date.now();
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

export function DashboardPage() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [agents, setAgents] = useState<AgentCardData[]>([]);
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [providerCount, setProviderCount] = useState(0);

  useEffect(() => {
    // Fetch system info
    window.electronAPI?.getSystemInfo().then((info) => {
      setSysInfo({
        platform: info.platform,
        arch: info.arch,
        version: info.version,
        electronVersion: info.electronVersion,
        chromeVersion: info.chromeVersion,
        nodeVersion: info.nodeVersion,
        cpuCores: info.cpuCores,
        totalMemoryGB: info.totalMemoryGB,
        freeMemoryGB: info.freeMemoryGB,
        gpu: info.gpu,
      });
    }).catch(() => {
      setSysInfo({
        platform: navigator.platform,
        arch: "unknown",
        version: "0.0.0",
        electronVersion: "-",
        chromeVersion: "-",
        nodeVersion: "-",
        cpuCores: navigator.hardwareConcurrency || 0,
        totalMemoryGB: 0,
        freeMemoryGB: 0,
      });
    });

    // Fetch agents from backend
    window.electronAPI?.listAgents().then(({ agents: agentRecords }) => {
      setAgents(agentRecords.map((a) => ({
        name: a.name,
        model: a.model ?? "unknown",
        status: (a.status === "running" ? "running" : a.status === "error" ? "error" : "idle") as "idle" | "running" | "error",
        lastActive: a.lastRun ? formatTimestamp(a.lastRun) : "Never",
        description: a.description ?? "",
      })));
    }).catch(() => {
      // Fallback: leave empty
    });

    // Fetch executions from backend
    window.electronAPI?.listExecutions().then(({ executions: execRecords }) => {
      const sorted = [...execRecords].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setExecutions(sorted.slice(0, 10).map((e) => ({
        id: e.id.slice(0, 8),
        workflowName: `Execution ${e.id.slice(0, 8)}`,
        status: (e.status === "running" ? "running" : e.status === "failed" ? "failed" : "completed") as "running" | "completed" | "failed",
        timestamp: new Date(e.createdAt).toLocaleString(),
        duration: e.startedAt ? formatDuration(e.startedAt, e.completedAt) : "-",
      })));
    }).catch(() => {
      // Fallback: leave empty
    });

    // Fetch provider count
    window.electronAPI?.listProviders().then(({ providers: provRecords }) => {
      setProviderCount(provRecords.length);
    }).catch(() => {
      // Fallback
    });
  }, []);

  const activeExecutions = executions.filter((e) => e.status === "running").length;
  const memoryUsed = sysInfo && sysInfo.totalMemoryGB > 0
    ? formatMemoryGB(sysInfo.totalMemoryGB - sysInfo.freeMemoryGB)
    : "-";

  const quickStats = [
    { label: "Total Agents", value: String(agents.length), icon: "🤖" },
    { label: "Active Executions", value: String(activeExecutions), icon: "⚡" },
    { label: "Providers Configured", value: String(providerCount), icon: "🔌" },
    { label: "Memory Used", value: memoryUsed, icon: "💾" },
  ];

  const systemCards = [
    { label: "Platform", value: sysInfo?.platform ?? "-", sub: sysInfo?.arch ?? "" },
    { label: "Version", value: sysInfo?.version ?? "-", sub: "" },
    { label: "CPU Cores", value: String(sysInfo?.cpuCores ?? "-"), sub: "" },
    { label: "Total Memory", value: sysInfo ? formatMemoryGB(sysInfo.totalMemoryGB) : "-", sub: sysInfo ? `${sysInfo.freeMemoryGB.toFixed(1)} GB free` : "" },
    { label: "Electron", value: sysInfo?.electronVersion ?? "-", sub: "" },
    { label: "Chrome", value: sysInfo?.chromeVersion ?? "-", sub: "" },
    { label: "Node.js", value: sysInfo?.nodeVersion ?? "-", sub: "" },
  ];

  return (
    <div className="dashboard-page p-6 lg:p-8 overflow-y-auto h-full">
      {/* ── Welcome Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 tracking-tight">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome to <span className="text-[#a78bfa] font-medium">Aether</span> — Autonomous AI Orchestration Platform</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-[#6335e7] hover:bg-[#7c4dfa] text-white text-sm font-medium rounded-lg transition-colors">
            + New Agent
          </button>
          <button className="px-4 py-2 border border-[#2a2a33] hover:border-[#6335e7]/50 text-gray-300 text-sm font-medium rounded-lg transition-colors">
            + New Workflow
          </button>
          <button className="px-4 py-2 border border-[#2a2a33] hover:border-[#6335e7]/50 text-gray-400 text-sm rounded-lg transition-colors">
            View Executions
          </button>
        </div>
      </div>

      {/* ── Quick Stats Bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {quickStats.map((stat) => (
          <div
            key={stat.label}
            className="bg-[#0f0f11] border border-[#1e1e24] rounded-xl p-4 hover:border-[#6335e7]/30 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{stat.icon}</span>
              <span className="text-xs text-gray-500 uppercase tracking-wider">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-gray-100">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── System Status Cards ── */}
      <div className="mb-8">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">System Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {systemCards.map((card) => (
            <div
              key={card.label}
              className="bg-[#0f0f11] border border-[#1e1e24] rounded-xl p-3.5 hover:border-[#6335e7]/30 transition-colors"
            >
              <span className="text-xs text-gray-500 uppercase tracking-wider">{card.label}</span>
              <p className="text-base font-semibold text-gray-200 mt-1">{card.value}</p>
              {card.sub && <p className="text-xs text-gray-600 mt-0.5">{card.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Agent Overview ── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Agent Overview</h3>
          <span className="text-xs text-gray-600">{agents.length} agents</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.length === 0 ? (
            <div className="col-span-full flex items-center justify-center h-24 bg-[#0f0f11] border border-dashed border-[#1e1e24] rounded-xl">
              <p className="text-gray-600 text-sm">No agents yet — create one to get started</p>
            </div>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.name}
                className="bg-[#0f0f11] border border-[#1e1e24] rounded-xl p-4 hover:border-[#6335e7]/30 transition-colors group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-200 truncate group-hover:text-[#a78bfa] transition-colors">
                      {agent.name}
                    </h4>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{agent.model}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${STATUS_BG[agent.status] || STATUS_BG.idle}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[agent.status] || "bg-gray-600"}`} />
                    {agent.status}
                  </span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{agent.description}</p>
                <p className="text-[10px] text-gray-700 mt-2">Last active: {agent.lastActive}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Recent Executions ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recent Executions</h3>
          <span className="text-xs text-gray-600">{executions.length} total</span>
        </div>
        <div className="bg-[#0f0f11] border border-[#1e1e24] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e24] bg-[#0a0a0d]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Execution ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Workflow</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                </tr>
              </thead>
              <tbody>
                {executions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-sm">
                      No executions yet
                    </td>
                  </tr>
                ) : (
                  executions.map((exec) => (
                    <tr
                      key={exec.id}
                      className="border-b border-[#1e1e24] last:border-0 hover:bg-[#14141a] transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{exec.id}</td>
                      <td className="px-4 py-3 text-gray-200 font-medium">{exec.workflowName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${STATUS_BG[exec.status] || STATUS_BG.idle}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[exec.status] || "bg-gray-600"}`} />
                          {exec.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{exec.timestamp}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 text-right font-mono">{exec.duration}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
