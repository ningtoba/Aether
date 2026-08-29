import React, { useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { ModelsPage } from './pages/ModelsPage';
import { SessionsPage } from './pages/SessionsPage';
import { LoopsPage } from './pages/LoopsPage';
import { SkillsPage } from './pages/SkillsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { AgentsPage } from './pages/AgentsPage';
import { SettingsPage } from './pages/SettingsPage';

export type PageId =
  | 'dashboard'
  | 'models'
  | 'sessions'
  | 'loops'
  | 'skills'
  | 'providers'
  | 'agents'
  | 'settings';

interface NavItem {
  id: PageId;
  label: string;
  group: 'Engine' | 'Control plane' | 'System';
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Engine' },
  { id: 'sessions', label: 'Sessions', group: 'Engine' },
  { id: 'loops', label: 'Loops', group: 'Engine' },
  { id: 'skills', label: 'Skills', group: 'Engine' },
  { id: 'models', label: 'Models', group: 'Control plane' },
  { id: 'providers', label: 'Providers', group: 'Control plane' },
  { id: 'agents', label: 'Agents', group: 'Control plane' },
  { id: 'settings', label: 'Settings', group: 'System' },
];

const GROUPS = ['Engine', 'Control plane', 'System'];

export function App() {
  const [page, setPage] = useState<PageId>('dashboard');

  const render = () => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={setPage} />;
      case 'models':
        return <ModelsPage />;
      case 'sessions':
        return <SessionsPage />;
      case 'loops':
        return <LoopsPage />;
      case 'skills':
        return <SkillsPage />;
      case 'providers':
        return <ProvidersPage />;
      case 'agents':
        return <AgentsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <DashboardPage onNavigate={setPage} />;
    }
  };

  return (
    <div className="layout">
      <nav className="sidebar">
        <h1>Aether</h1>
        <div className="tagline">Autonomous AI orchestration</div>
        {GROUPS.map((group) => (
          <div key={group} className="nav-group">
            <div className="nav-group-label">{group}</div>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button
                key={n.id}
                className={`nav-item ${page === n.id ? 'active' : ''}`}
                onClick={() => setPage(n.id)}
              >
                <span className={`dot ${group === 'Engine' ? 'engine' : 'experiment'}`} />
                {n.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="main">
        <div className="page">{render()}</div>
      </main>
    </div>
  );
}
