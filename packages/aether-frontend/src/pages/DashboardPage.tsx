import React, { useEffect, useState } from 'react';
import { getHealth, listSessions, listLoops, type HealthStatus } from '../lib/api';
import type { PageId } from '../App';

export function DashboardPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [sessions, setSessions] = useState<number>(0);
  const [loops, setLoops] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => setHealth(h))
      .catch((e) => setError(e.message));
    listSessions()
      .then((r) => setSessions(r.sessions.length))
      .catch(() => {});
    listLoops()
      .then((r) => setLoops(r.loops.length))
      .catch(() => {});
  }, []);

  const engineLive = health?.engine?.available;
  const realtimePort = health?.realtime?.port;

  return (
    <>
      <h2>Dashboard</h2>
      {error && <div className="muted">Backend unreachable: {error}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="card">
          <h3>Engine</h3>
          <div className="row">
            <span className={`tag ${engineLive ? 'running' : 'stopped'}`}>
              {engineLive ? 'available' : 'unavailable'}
            </span>
            {health?.engine?.error && <span className="muted">{health.engine.error}</span>}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {engineLive ? 'Agent sessions, loops & skills are wired' : 'Requires the Bun runtime + omp SDK'}
          </div>
        </div>
        <div className="card">
          <h3>Sessions</h3>
          <div className="row">
            <span style={{ fontSize: 26 }}>{sessions}</span>
            <button className="btn" onClick={() => onNavigate('sessions')}>
              Open
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Loops</h3>
          <div className="row">
            <span style={{ fontSize: 26 }}>{loops}</span>
            <button className="btn" onClick={() => onNavigate('loops')}>
              Open
            </button>
          </div>
        </div>
        <div className="card">
          <h3>Realtime hub</h3>
          <div className="muted">ws://…:{realtimePort ?? '?'}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Live engine events stream here to the GUI
          </div>
        </div>
      </div>

      {health && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Backend health</h3>
          <div className="stack">
            <div className="row">
              <span className="muted" style={{ width: 90 }}>
                Version
              </span>
              <span className="mono">{health.version}</span>
            </div>
            <div className="row">
              <span className="muted" style={{ width: 90 }}>
                Uptime
              </span>
              <span className="mono">{health.uptime}s</span>
            </div>
            <div className="row">
              <span className="muted" style={{ width: 90 }}>
                Providers
              </span>
              <span className="mono">
                {health.providers.configured} configured / {health.providers.healthy} healthy
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
