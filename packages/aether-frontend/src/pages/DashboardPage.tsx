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
import {
  Card,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  StatCard,
  StatusPill,
  fmtUptime,
  type IconName,
} from '../components/ui';
import type { PageId } from '../App';

type LoadingKey = 'health' | 'facade' | 'sessions' | 'disk' | 'loops' | 'models' | 'skills';

interface Agg {
  health: HealthStatus | null;
  facade: FacadeStatus | null;
  sessions: number;
  /** null until the disk-sessions endpoint resolves (never a fake 0). */
  diskSessions: number | null;
  loops: number;
  models: number;
  providers: number;
  skills: number;
  loading: Record<LoadingKey, boolean>;
  /** Per-endpoint failures; data that DID load stays visible alongside them. */
  errors: string[];
}

function initialAgg(): Agg {
  return {
    health: null,
    facade: null,
    sessions: 0,
    diskSessions: null,
    loops: 0,
    models: 0,
    providers: 0,
    skills: 0,
    loading: {
      health: true,
      facade: true,
      sessions: true,
      disk: true,
      loops: true,
      models: true,
      skills: true,
    },
    errors: [],
  };
}

const QUICK_ACTIONS: Array<{ page: PageId; icon: IconName; label: string; desc: string }> = [
  {
    page: 'sessions',
    icon: 'plus',
    label: 'New session',
    desc: 'Open the sessions console and start prompting a model.',
  },
  {
    page: 'loops',
    icon: 'play',
    label: 'New loop',
    desc: 'Compose a repeatable loop with round transitions.',
  },
  {
    page: 'settings',
    icon: 'settings',
    label: 'Settings',
    desc: 'Tune the omp engine settings live.',
  },
];

export function DashboardPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const [agg, setAgg] = useState<Agg>(initialAgg);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let dead = false;
    setAgg(initialAgg());

    const patch = (p: Partial<Agg>) => {
      if (!dead) setAgg((a) => ({ ...a, ...p }));
    };
    const finish = (key: LoadingKey) => {
      if (!dead) setAgg((a) => ({ ...a, loading: { ...a.loading, [key]: false } }));
    };
    // Surface every failed endpoint instead of swallowing it; successful
    // endpoints keep their loaded data untouched.
    const fail = (label: string) => (e: unknown) => {
      if (dead) return;
      const msg = e instanceof Error ? e.message : String(e);
      setAgg((a) => ({ ...a, errors: [...a.errors, `${label}: ${msg}`] }));
    };

    getHealth()
      .then((h) => patch({ health: h }))
      .catch(fail('health'))
      .finally(() => finish('health'));
    listSessions()
      .then((r) => patch({ sessions: r.sessions.length }))
      .catch(fail('live sessions'))
      .finally(() => finish('sessions'));
    listLoops()
      .then((r) =>
        patch({
          loops: r.loops.length,
          // loop run statuses stream live via the realtime hub, not the list
        }),
      )
      .catch(fail('loops'))
      .finally(() => finish('loops'));
    listModels()
      .then((r) => {
        const models = r.groups.reduce((n, g) => n + g.models.length, 0);
        patch({ models, providers: r.groups.length });
      })
      .catch(fail('models'))
      .finally(() => finish('models'));
    listDiskSessions()
      .then((r) => patch({ diskSessions: (r.sessions ?? []).length }))
      .catch(fail('disk sessions'))
      .finally(() => finish('disk'));
    listOmpSkills()
      .then((r) => patch({ skills: (r.skills ?? []).length }))
      .catch(fail('skills'))
      .finally(() => finish('skills'));
    listFacadeProviders().catch(fail('omp providers'));
    getFacadeStatus()
      .then((r) => patch({ facade: r.status }))
      .catch(fail('engine status'))
      .finally(() => finish('facade'));

    return () => {
      dead = true;
    };
  }, [reloadKey]);

  const { health, facade, errors, loading } = agg;
  const engineLive = health?.engine?.available;
  const ompReady = facade?.available === true;
  /* Capability split: exported SDK features stay visible; the "not exported"
   * set is internal debug noise and gets collapsed behind a disclosure. */
  const exportedCaps = (facade?.capabilities ?? []).filter((c) => c.available);
  const internalCaps = (facade?.capabilities ?? []).filter((c) => !c.available);
  const iconBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--s-2)',
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            {engineLive === undefined
              ? 'engine state pending'
              : engineLive
                ? 'engine live'
                : 'engine down'}
            {health?.realtime?.port ? ` · realtime :${health.realtime.port}` : ''}
          </>
        }
        actions={
          <button className="btn" style={iconBtn} onClick={() => setReloadKey((k) => k + 1)}>
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      {errors.length > 0 && (
        <ErrorState
          message={
            <>
              Some data unreachable — {errors.join(' · ')}. Everything that did load is shown below.
            </>
          }
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      )}

      <div className="stack">
        <div className="grid stats">
          <button
            type="button"
            className="card-ghost"
            onClick={() => onNavigate('sessions')}
            title="Open sessions"
          >
            <StatCard
              label="Sessions"
              icon="sessions"
              tone="info"
              /* Headline is the live engine-session count; the hint states the whole
               * pair in the same wording as the Sessions view header, so headline and
               * caption can never contradict each other. Disk data that has not
               * resolved is omitted — never a fabricated total. */
              value={loading.sessions ? <Skeleton rows={1} /> : agg.sessions}
              hint={
                loading.sessions
                  ? 'loading…'
                  : agg.diskSessions === null
                    ? `${agg.sessions} live`
                    : `${agg.sessions} live · ${agg.diskSessions} on disk`
              }
            />
          </button>
          <button
            type="button"
            className="card-ghost"
            onClick={() => onNavigate('loops')}
            title="Open loops"
          >
            <StatCard
              label="Loops"
              icon="loops"
              tone="idle"
              value={loading.loops ? <Skeleton rows={1} /> : agg.loops}
              hint={loading.loops ? 'loading…' : 'definitions saved'}
            />
          </button>
          <button
            type="button"
            className="card-ghost"
            onClick={() => onNavigate('models')}
            title="Open models"
          >
            <StatCard
              label="Models"
              icon="models"
              tone="ok"
              value={loading.models ? <Skeleton rows={1} /> : agg.models}
              hint={loading.models ? 'loading…' : `across ${agg.providers} providers`}
            />
          </button>
          <button
            type="button"
            className="card-ghost"
            onClick={() => onNavigate('skills')}
            title="Open skills"
          >
            <StatCard
              label="Skills"
              icon="skills"
              tone="warn"
              value={loading.skills ? <Skeleton rows={1} /> : agg.skills}
              hint={loading.skills ? 'loading…' : 'discoverable SKILL.md packs'}
            />
          </button>
        </div>

        {(loading.facade || engineLive || ompReady) && (
          <Card
            title="Engine"
            actions={
              loading.facade ? null : (
                <StatusPill tone={ompReady ? 'ok' : 'idle'} dot>
                  omp {facade?.version ?? 'unknown'}
                </StatusPill>
              )
            }
          >
            {loading.facade ? (
              <Skeleton rows={2} />
            ) : (
              <div className="stack">
                <div className="row">
                  <span className="muted mono" style={{ fontSize: 12 }}>
                    runtime {facade?.runtime}
                  </span>
                </div>
                {exportedCaps.length + internalCaps.length > 0 && (
                  <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {exportedCaps.map((c) => (
                      <StatusPill key={c.name} tone="ok" dot>
                        {c.name}
                      </StatusPill>
                    ))}
                    {internalCaps.length > 0 && (
                      <details>
                        <summary
                          style={{ display: 'inline-flex', cursor: 'pointer', listStyle: 'none' }}
                        >
                          <StatusPill tone="idle">+ {internalCaps.length} internal</StatusPill>
                        </summary>
                        <div className="row" style={{ flexWrap: 'wrap', marginTop: 'var(--s-2)' }}>
                          {internalCaps.map((c) => (
                            <span key={c.name} title={c.error ?? 'not exported by this SDK build'}>
                              <StatusPill tone="idle">{c.name}</StatusPill>
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        <Card title="Backend health">
          {loading.health ? (
            <Skeleton rows={3} />
          ) : health ? (
            <div className="stack">
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <StatusPill
                  tone={health.status === 'ok' ? (engineLive ? 'ok' : 'warn') : 'error'}
                  dot
                >
                  {health.status}
                </StatusPill>
                <StatusPill tone={engineLive ? 'ok' : 'warn'} dot>
                  engine {engineLive ? 'live' : 'unavailable'}
                </StatusPill>
                <StatusPill tone="idle">v{health.version}</StatusPill>
                <StatusPill tone="idle">up {fmtUptime(health.uptime)}</StatusPill>
              </div>
              {health.memory && (
                <div className="row">
                  <span className="muted" style={{ fontSize: 12 }}>
                    heap {(health.memory.heapUsed / 1048576).toFixed(1)} MB · rss{' '}
                    {(health.memory.rss / 1048576).toFixed(1)} MB
                  </span>
                </div>
              )}
              <div className="row">
                <span className="muted" style={{ fontSize: 12 }}>
                  {health.realtime?.port
                    ? `realtime ws://${location.hostname}:${health.realtime.port}`
                    : 'realtime endpoint unknown'}{' '}
                  · providers: {health.providers?.healthy} configured ·{' '}
                  {health.providers?.configured} in registry
                </span>
              </div>
            </div>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              Health endpoint unreachable — see the alert above.
            </span>
          )}
        </Card>

        <Card title="Quick actions">
          <div className="grid cols-3">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.page}
                type="button"
                className="card-ghost"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--s-3)',
                  textAlign: 'left',
                  padding: 'var(--s-3)',
                }}
                onClick={() => onNavigate(a.page)}
              >
                <span aria-hidden="true" style={{ color: 'var(--accent)', marginTop: 2 }}>
                  <Icon name={a.icon} size={18} />
                </span>
                <span className="stack" style={{ gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{a.label}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {a.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
