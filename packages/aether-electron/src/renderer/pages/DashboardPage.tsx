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

const MOCK_AGENTS: AgentCardData[] = [
  { name: "Hermes Reasoner", model: "DeepSeek-V3-Flash", status: "idle", lastActive: "2 min ago", description: "General reasoning & code generation" },
  { name: "Code Analyst", model: "GPT-4o", status: "running", lastActive: "Just now", description: "Code review & static analysis" },
  { name: "Data Pipeline", model: "Claude 3 Opus", status: "idle", lastActive: "15 min ago", description: "ETL & data transformation" },
  { name: "Security Scanner", model: "Llama 3 70B", status: "error", lastActive: "1 hr ago", description: "Vulnerability assessment & auditing" },
  { name: "Research Agent", model: "Gemini Pro", status: "idle", lastActive: "3 hrs ago", description: "Web research & summarization" },
  { name: "Workflow Orchestrator", model: "DeepSeek-V4", status: "running", lastActive: "30 sec ago", description: "Multi-agent workflow coordination" },
];

const MOCK_EXECUTIONS: ExecutionRow[] = [
  { id: "exec-001", workflowName: "Code Review Pipeline", status: "completed", timestamp: "2026-05-10 23:45:12", duration: "2m 34s" },
  { id: "exec-002", workflowName: "Data Analysis Suite", status: "running", timestamp: "2026-05-10 23:50:01", duration: "12m 18s" },
  { id: "exec-003", workflowName: "Security Audit", status: "failed", timestamp: "2026-05-10 22:30:44", duration: "1m 05s" },
  { id: "exec-004", workflowName: "Research Sync", status: "completed", timestamp: "2026-05-10 21:15:33", duration: "45s" },
  { id: "exec-005", workflowName: "Deploy Pipeline", status: "completed", timestamp: "2026-05-10 20:00:00", duration: "5m 22s" },
  { id: "exec-006", workflowName: "Model Fine-tuning", status: "running", timestamp: "2026-05-10 19:45:10", duration: "48m 12s" },
  { id: "exec-007", workflowName: "Log Aggregation", status: "failed", timestamp: "2026-05-10 18:00:30", duration: "3m 10s" },
];

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

export function DashboardPage() {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
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
  }, []);

  const activeExecutions = MOCK_EXECUTIONS.filter((e) => e.status === "running").length;
  const memoryUsed = sysInfo && sysInfo.totalMemoryGB > 0
    ? formatMemoryGB(sysInfo.totalMemoryGB - sysInfo.freeMemoryGB)
    : "-";

  const quickStats = [
    { label: "Total Agents", value: String(MOCK_AGENTS.length), icon: "🤖" },
    { label: "Active Executions", value: String(activeExecutions), icon: "⚡" },
    { label: "Providers Configured", value: "4", icon: "🔌" },
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
          <span className="text-xs text-gray-600">{MOCK_AGENTS.length} agents</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MOCK_AGENTS.map((agent) => (
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
          ))}
        </div>
      </div>

      {/* ── Recent Executions ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recent Executions</h3>
          <span className="text-xs text-gray-600">{MOCK_EXECUTIONS.length} total</span>
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
                {MOCK_EXECUTIONS.map((exec) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
