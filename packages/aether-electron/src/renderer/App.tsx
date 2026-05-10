import React, { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { DashboardPage } from "./pages/DashboardPage";
import { ProviderPage } from "./pages/ProviderPage";
import { AgentPage } from "./pages/AgentPage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ExecutionPage } from "./pages/ExecutionPage";
import { PluginPage } from "./pages/PluginPage";
import { SettingsPage } from "./pages/SettingsPage";

export type PageId =
  | "dashboard"
  | "providers"
  | "agents"
  | "workflows"
  | "memory"
  | "execution"
  | "plugins"
  | "settings";

export interface PageInfo {
  id: PageId;
  label: string;
  icon: string;
}

export const PAGES: PageInfo[] = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "providers", label: "Providers", icon: "🔌" },
  { id: "agents", label: "Agents", icon: "🤖" },
  { id: "workflows", label: "Workflows", icon: "🔀" },
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "execution", label: "Execution", icon: "▶️" },
  { id: "plugins", label: "Plugins", icon: "🧩" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export function App() {
  const [currentPage, setCurrentPage] = useState<PageId>("dashboard");
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI?.onMaximizeChange?.((maximized) => {
      setIsMaximized(maximized);
    });
    window.electronAPI?.getIsMaximized?.().then(setIsMaximized);
  }, []);

  const renderPage = useCallback(() => {
    switch (currentPage) {
      case "dashboard":  return <DashboardPage />;
      case "providers":  return <ProviderPage />;
      case "agents":     return <AgentPage />;
      case "workflows":  return <WorkflowPage />;
      case "memory":     return <MemoryPage />;
      case "execution":  return <ExecutionPage />;
      case "plugins":    return <PluginPage />;
      case "settings":   return <SettingsPage />;
      default:           return <DashboardPage />;
    }
  }, [currentPage]);

  return (
    <div className="app-container">
      <TitleBar isMaximized={isMaximized} />
      <div className="app-body">
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
        <main className="main-content">{renderPage()}</main>
      </div>
    </div>
  );
}
