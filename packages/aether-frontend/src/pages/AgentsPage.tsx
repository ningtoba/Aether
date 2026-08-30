/**
 * Agents — omp agent catalog (bundled + ~/.omp/agent/agents + .omp/agents) with
 * a legacy control-plane fallback when the embedded engine (Bun) is unavailable.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { listOmpAgents, listAgents, type AgentDef, type AgentRecord } from '../lib/api';
import {
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusPill,
  fmtRelative,
  type StatusTone,
} from '../components/ui';

type SourceFilter = 'all' | 'bundled' | 'user' | 'project';

const SOURCES: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'bundled', label: 'Bundled' },
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' },
];

const KIND_TONE: Record<AgentDef['source'], StatusTone> = {
  bundled: 'idle',
  user: 'ok',
  project: 'info',
};

function inspectText(a: AgentDef): string {
  let out = '';
  if (a.frontmatter && Object.keys(a.frontmatter).length > 0) {
    out += '---\n';
    for (const [k, v] of Object.entries(a.frontmatter)) {
      out += `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}\n`;
    }
    out += '---\n';
  }
  if (a.body) out += a.body;
  return out.trim();
}

function legacyTone(status: string): StatusTone {
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  return 'idle';
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [legacy, setLegacy] = useState<AgentRecord[]>([]);
  const [mode, setMode] = useState<'loading' | 'omp' | 'legacy'>('loading');
  const [source, setSource] = useState<SourceFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    setMode('loading');
    setError(null);
    (async () => {
      try {
        const r = await listOmpAgents();
        if (cancelled) return;
        setAgents(r.agents);
        setMode('omp');
      } catch {
        if (cancelled) return;
        // Engine unavailable (e.g. plain-Node backend) → degrade to the legacy
        // control-plane registry with a neutral hint.
        try {
          const legacyRes = await listAgents();
          if (cancelled) return;
          setLegacy(legacyRes.agents);
        } catch (e2) {
          if (cancelled) return;
          setError((e2 as Error).message);
        }
        setMode('legacy');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(refresh, [refresh]);

  const q = query.trim().toLowerCase();
  const filtered = agents.filter((a) => {
    if (source !== 'all' && a.source !== source) return false;
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      (a.description ?? '').toLowerCase().includes(q) ||
      (a.path ?? '').toLowerCase().includes(q)
    );
  });

  const filtering = q !== '' || source !== 'all';
  const current = filtered.find((a) => a.name === selected) ?? null;
  const currentText = current ? inspectText(current) : '';

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle={
          mode === 'loading'
            ? 'Loading the agent catalog…'
            : mode === 'omp'
              ? `${filtered.length} of ${agents.length} agents in the omp catalog (bundled, user, project)`
              : 'Legacy control-plane agent registry — the omp engine catalog is unavailable.'
        }
        actions={
          mode === 'omp' ? (
            <input
              className="input"
              style={{ width: 260 }}
              placeholder="Search name, description or path…"
              aria-label="Search agents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : undefined
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}

      {mode === 'loading' && <Skeleton rows={6} />}

      {mode === 'omp' && (
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <SegmentedControl
              value={source}
              onChange={setSource}
              options={SOURCES.map((s) => ({ value: s.id, label: s.label }))}
            />
            <span className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>
              {agents.length} agent{agents.length === 1 ? '' : 's'} loaded
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon="agents"
              title="No matching agents"
              message={
                agents.length === 0
                  ? 'The omp engine reported an empty agent catalog.'
                  : 'Try a different source or search term.'
              }
              action={
                filtering ? (
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setQuery('');
                      setSource('all');
                    }}
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid cols-3">
              {filtered.map((a) => {
                const isSel = selected === a.name;
                return (
                  <div
                    key={a.name}
                    className="card card-ghost"
                    style={
                      isSel
                        ? {
                            borderColor: 'var(--accent)',
                            boxShadow: 'inset 2px 0 0 var(--accent-strong), var(--shadow-1)',
                          }
                        : undefined
                    }
                  >
                    <div className="card-header">
                      <span
                        className="truncate"
                        style={{ maxWidth: 160, fontWeight: 600 }}
                        title={a.name}
                      >
                        {a.name}
                      </span>
                      <StatusPill tone={KIND_TONE[a.source]}>{a.source}</StatusPill>
                      <span className="spacer" />
                      <button
                        className="btn ghost sm"
                        aria-pressed={isSel}
                        onClick={() => setSelected(isSel ? null : a.name)}
                      >
                        {isSel ? 'Close' : 'Inspect'}
                      </button>
                    </div>
                    <div className="card-body stack" style={{ gap: 6, alignItems: 'flex-start' }}>
                      <span
                        className="muted clamp-2"
                        style={{ fontSize: 12 }}
                        title={a.description || undefined}
                      >
                        {a.description || `Bundled ${a.source} agent`}
                      </span>
                      {a.path && (
                        <span
                          className="muted mono truncate"
                          style={{ fontSize: 11 }}
                          title={a.path}
                        >
                          {a.path}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {current && (
            <Card
              title={
                <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <span style={{ fontWeight: 600 }}>{current.name}</span>
                  <StatusPill tone={KIND_TONE[current.source]}>{current.source}</StatusPill>
                </span>
              }
              actions={
                current.path ? (
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <span
                      className="mono muted truncate"
                      style={{ fontSize: 11, maxWidth: 360 }}
                      title={current.path}
                    >
                      {current.path}
                    </span>
                    <CopyButton text={current.path} title="Copy agent path" />
                  </span>
                ) : undefined
              }
            >
              {currentText ? (
                <pre
                  className="code-preview"
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    maxHeight: 480,
                    overflowY: 'auto',
                  }}
                >
                  {currentText}
                </pre>
              ) : (
                <span className="muted">
                  No body on disk — this agent ships with the bundled engine and has no editable
                  markdown to inspect.
                </span>
              )}
            </Card>
          )}
        </div>
      )}

      {mode === 'legacy' && (
        <div className="stack">
          <Card>
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>
                The omp agent catalog (bundled + <code>~/.omp/agent/agents/*.md</code> +{' '}
                <code>.omp/agents/*.md</code>) is served by the embedded engine, which is not
                configured on this server (plain-Node backend — the engine needs the Bun runtime).
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Showing the legacy control-plane agent registry instead.
              </span>
            </div>
          </Card>
          <Card title={`Registered agents (${legacy.length})`}>
            {legacy.length === 0 ? (
              <EmptyState
                icon="agents"
                title="No agents registered"
                message="Start the backend under Bun to unlock the real omp agent catalog."
              />
            ) : (
              <div style={{ overflow: 'auto', maxHeight: 440 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacy.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="mono">{a.id}</span>
                            <CopyButton text={a.id} title="Copy agent id" />
                          </div>
                        </td>
                        <td style={{ fontWeight: 600 }}>{a.name}</td>
                        <td>
                          <StatusPill tone={legacyTone(a.status)} dot={a.status === 'running'}>
                            {a.status}
                          </StatusPill>
                        </td>
                        <td className="mono muted" title={new Date(a.createdAt).toLocaleString()}>
                          {fmtRelative(a.createdAt) || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
