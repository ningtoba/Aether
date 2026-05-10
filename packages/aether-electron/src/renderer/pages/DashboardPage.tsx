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
      });
    }).catch(() => {
      // If electronAPI not available (dev mode), use fallback
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

  const cards = [
    { label: "Platform", value: sysInfo?.platform ?? "-", icon: "💻" },
    { label: "Version", value: sysInfo?.version ?? "-", icon: "🏷️" },
    { label: "CPU Cores", value: String(sysInfo?.cpuCores ?? "-"), icon: "⚡" },
    { label: "Total Memory", value: sysInfo ? `${sysInfo.totalMemoryGB.toFixed(1)} GB` : "-", icon: "💾" },
    { label: "Free Memory", value: sysInfo ? `${sysInfo.freeMemoryGB.toFixed(1)} GB` : "-", icon: "📊" },
    { label: "Electron", value: sysInfo?.electronVersion ?? "-", icon: "⚛️" },
    { label: "Chrome", value: sysInfo?.chromeVersion ?? "-", icon: "🌐" },
    { label: "Node.js", value: sysInfo?.nodeVersion ?? "-", icon: "📦" },
  ];

  return (
    <div className="dashboard-page p-8">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-100 mb-2">Dashboard</h1>
        <p className="text-gray-500 text-sm">Welcome to Aether — Autonomous AI Orchestration Platform</p>
      </div>

      {/* Branding */}
      <div className="flex items-center gap-4 mb-10 p-6 bg-gradient-to-br from-[#1c1c24] to-[#121218] rounded-2xl border border-[#2a2a33]">
        <div className="text-5xl">✦</div>
        <div>
          <h2 className="text-xl font-bold text-gray-100">Aether</h2>
          <p className="text-gray-500 text-sm mt-1">
            Orchestrate AI agents, providers, and workflows in a unified environment.
          </p>
        </div>
      </div>

      {/* System Info Cards */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">System Information</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className="bg-[#14141a] border border-[#1e1e24] rounded-xl p-4 hover:border-[#6335e7]/30 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{card.icon}</span>
                <span className="text-xs text-gray-500 uppercase tracking-wider">{card.label}</span>
              </div>
              <p className="text-lg font-semibold text-gray-200">{card.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
