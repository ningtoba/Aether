import React, { useEffect, useState } from 'react';
import {
  getHealth,
  listSessions,
  listLoops,
  listModels,
  listDiskSessions,
  listOmpSkills,
  listFacadeProviders,
  getFacadeStatus,
  type HealthStatus,
  type FacadeStatus,
} from '../lib/api';
import type { PageId } from '../App';

interface Agg {
  health: HealthStatus | null;
  facade: FacadeStatus | null;
  sessions: number;
  diskSessions: number;
  loops: number;
  loopsRunning: number;
  models: number;
  providers: number;
  skills: number;
  error: string | null;
}

export function DashboardPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const [agg, setAgg] = useState<Agg>({
    health: null,
    facade: null,
    sessions: 0,
    diskSessions: 0,
    loops: 0,
    loopsRunning: 0,
    models: 0,
    providers: 0,
    skills: 0,
    error: null,
  });

  useEffect(() => {
    let dead = false;
    const patch = (p: Partial<Agg>) => {
      if (!dead) setAgg((a) => ({ ...a, ...p }));
    };

    getHealth()
      .then((h) => patch({ health: h }))
      .catch((e) => patch({ error: e.message }));
    listSessions()
      .then((r) => patch({ sessions: r.sessions.length }))
      .catch(() => {});
    listLoops()
      .then((r) =>
        patch({
          loops: r.loops.length,
          // loop run statuses stream live via the realtime hub, not the list
        }),
      )
      .catch(() => {});
    listModels()
      .then((r) => {
        const models = r.groups.reduce((n, g) => n + g.models.length, 0);
        patch({ models, providers: r.groups.length });
      })
      .catch(() => {});
    listDiskSessions()
      .then((r) => patch({ diskSessions: (r.sessions ?? []).length }))
      .catch(() => {});
    listOmpSkills()
      .then((r) => patch({ skills: (r.skills ?? []).length }))
      .catch(() => {});
    listFacadeProviders()
      .then((r) => patch({ providers: (r.providers ?? []).length }))
      .catch(() => {});
    getFacadeStatus()
      .then((r) => patch({ facade: r.status }))
      .catch(() => {});

    return () => {
      dead = true;
    };
  }, []);

  const { health, facade, error } = agg;
  const engineLive = health?.engine?.available;
  const ompReady = facade?.available === true;

  return (
    <>
      <h2>Dashboard</h2>
      {error && <div className="muted">Some data unreachable: {error}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <button
          className="card"
          style={{ textAlign: 'left' }}
          onClick={() => onNavigate('sessions')}
        >
          <h3>Sessions</h3>
          <div className="big">{agg.sessions}</div>
          <div className="muted">live · {agg.diskSessions} persisted on disk</div>
        </button>
        <button className="card" style={{ textAlign: 'left' }} onClick={() => onNavigate('loops')}>
          <h3>Loops</h3>
          <div className="big">{agg.loops}</div>
          <div className="muted">definitions saved</div>
        </button>
        <button className="card" style={{ textAlign: 'left' }} onClick={() => onNavigate('models')}>
          <h3>Models</h3>
          <div className="big">{agg.models}</div>
          <div className="muted">across {agg.providers} providers</div>
        </button>
        <button className="card" style={{ textAlign: 'left' }} onClick={() => onNavigate('skills')}>
          <h3>Skills</h3>
          <div className="big">{agg.skills}</div>
          <div className="muted">discoverable SKILL.md packs</div>
        </button>
      </div>

      {(engineLive || ompReady) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Engine</h3>
          <div className="stack">
            <div className="row">
              <span
                className="tag"
                style={{ borderColor: ompReady ? 'var(--green)' : 'var(--yellow)' }}
              >
                omp {facade?.version ?? 'unknown'}
              </span>
              <span className="muted">runtime {facade?.runtime}</span>
            </div>
            {facade?.capabilities && facade.capabilities.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {facade.capabilities.map((c) => (
                  <span
                    key={c.name}
                    className="tag"
                    style={{ borderColor: c.available ? 'var(--green)' : 'var(--red)' }}
                    title={c.error ?? ''}
                  >
                    {c.name} {c.available ? '✓' : '✗'}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {health && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Backend health</h3>
          <div className="stack">
            <div className="row">
              <span
                className="tag"
                style={{ borderColor: engineLive ? 'var(--green)' : 'var(--red)' }}
              >
                {health.status}
              </span>
              <span className="tag">v{health.version}</span>
              <span className="tag">up {health.uptime}s</span>
            </div>
            {health.memory && (
              <div className="row">
                <span className="muted">
                  heap {(health.memory.heapUsed / 1048576).toFixed(1)} MB · rss{' '}
                  {(health.memory.rss / 1048576).toFixed(1)} MB
                </span>
              </div>
            )}
            <div className="row">
              <span className="muted">
                realtime ws://…:{health.realtime?.port} · providers {health.providers?.configured}{' '}
                configured / {health.providers?.healthy} healthy
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Quick actions</h3>
        <div className="row">
          <button className="btn primary" onClick={() => onNavigate('sessions')}>
            New session
          </button>
          <button className="btn primary" onClick={() => onNavigate('loops')}>
            New loop
          </button>
          <button className="btn" onClick={() => onNavigate('settings')}>
            Settings
          </button>
        </div>
      </div>
    </>
  );
}
