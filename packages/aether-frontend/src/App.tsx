import React, { useEffect, useState } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { ModelsPage } from './pages/ModelsPage';
import { SessionsPage } from './pages/SessionsPage';
import { LoopsPage } from './pages/LoopsPage';
import { SkillsPage } from './pages/SkillsPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { AgentsPage } from './pages/AgentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Icon, type IconName } from './components/ui';
import type { HealthStatus } from './lib/api';

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
  icon: IconName;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Engine', icon: 'dashboard' },
  { id: 'sessions', label: 'Sessions', group: 'Engine', icon: 'sessions' },
  { id: 'loops', label: 'Loops', group: 'Engine', icon: 'loops' },
  { id: 'skills', label: 'Skills', group: 'Engine', icon: 'skills' },
  { id: 'models', label: 'Models', group: 'Control plane', icon: 'models' },
  { id: 'providers', label: 'Providers', group: 'Control plane', icon: 'providers' },
  { id: 'agents', label: 'Agents', group: 'Control plane', icon: 'agents' },
  { id: 'settings', label: 'Settings', group: 'System', icon: 'settings' },
];

const GROUPS: NavItem['group'][] = ['Engine', 'Control plane', 'System'];

/** Hand-authored logomark: rounded frame + "A" glyph, two-tone accent. */
function Logomark(): React.ReactElement {
  return (
    <svg
      className="brand-mark"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="6" />
      <path d="M8.2 16.3 12 7.7l3.8 8.6" stroke="var(--accent-strong)" />
      <path d="M9.8 13.5h4.4" stroke="var(--accent-strong)" />
    </svg>
  );
}

/** Sidebar footer state: one /health probe, silently degraded when unreachable. */
type EngineProbe =
  | { state: 'checking' }
  | { state: 'down' }
  | { state: 'ok'; health: HealthStatus };

function useHealthProbe(): EngineProbe {
  const [probe, setProbe] = useState<EngineProbe>({ state: 'checking' });

  useEffect(() => {
    const ac = new AbortController();
    fetch('/health', { signal: ac.signal, headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<HealthStatus>) : null))
      .then((health) => setProbe(health ? { state: 'ok', health } : { state: 'down' }))
      .catch(() => {
        if (!ac.signal.aborted) setProbe({ state: 'down' });
      });
    return () => ac.abort();
  }, []);

  return probe;
}

function footerStatus(probe: EngineProbe): {
  engine: { dot: string; text: string; title: string };
  realtime: { dot: string; text: string; title: string };
} {
  if (probe.state === 'checking') {
    return {
      engine: { dot: 'idle', text: 'engine · checking', title: 'Probing /health …' },
      realtime: { dot: 'idle', text: 'realtime · waiting', title: 'Waiting for /health …' },
    };
  }
  if (probe.state === 'down') {
    return {
      engine: { dot: 'idle', text: 'engine · unavailable', title: 'Backend /health unreachable' },
      realtime: { dot: 'idle', text: 'realtime · unknown', title: 'Backend /health unreachable' },
    };
  }
  const { health } = probe;
  const engineDown = health.engine?.available === false;
  const version = health.omp?.version ?? health.version;
  return {
    engine: {
      dot: engineDown ? 'warn' : 'ok',
      text: engineDown ? 'engine · offline' : `engine · v${version}`,
      title: engineDown
        ? (health.engine?.error ?? 'Embedded engine is not available')
        : `Engine available (omp ${version ?? 'unknown'})`,
    },
    realtime: {
      dot: health.realtime?.port ? 'ok' : 'idle',
      text: health.realtime?.port ? `realtime · :${health.realtime.port}` : 'realtime · off',
      title: health.realtime?.port
        ? `Realtime event hub on port ${health.realtime.port}`
        : 'Realtime event hub not advertised',
    },
  };
}

export function App() {
  const [page, setPage] = useState<PageId>('dashboard');
  const probe = useHealthProbe();
  const status = footerStatus(probe);

  const render = () => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={setPage} />;
      case 'models':
        return <ModelsPage />;
      case 'sessions':
        return <SessionsPage />;
      case 'loops':
        return <LoopsPage onNavigate={setPage} />;
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
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">
          <Logomark />
          <span className="brand-text">
            <span className="brand-name">Aether</span>
            <span className="brand-tagline">Autonomous AI orchestration</span>
          </span>
        </div>

        {GROUPS.map((group) => (
          <div key={group} className="nav-group">
            <div className="nav-group-label">{group}</div>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button
                key={n.id}
                type="button"
                className={page === n.id ? 'nav-item active' : 'nav-item'}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
              >
                <span className="nav-icon">
                  <Icon name={n.icon} size={16} />
                </span>
                <span className="nav-label">{n.label}</span>
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="status-row" title={status.engine.title}>
            <span className={`status-dot ${status.engine.dot}`} />
            <span className="status-text">{status.engine.text}</span>
          </div>
          <div className="status-row" title={status.realtime.title}>
            <span className={`status-dot ${status.realtime.dot}`} />
            <span className="status-text">{status.realtime.text}</span>
          </div>
        </div>
      </nav>

      <main className="main">
        <div className="page">{render()}</div>
      </main>
    </div>
  );
}
