/**
 * Agents — the omp agent catalog (bundled + ~/.omp/agent/agents + .omp/agents).
 * This is the ONLY agent plane: the simulated /api/agents registry was deleted,
 * so a failed catalog load surfaces as an explicit error, never as fake data.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { listOmpAgents, type AgentDef } from '../lib/api';
import {
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatusPill,
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

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  // The simulated registry is gone — the only modes are loading, a loaded
  // catalog, and an honest error.
  const [mode, setMode] = useState<'loading' | 'omp' | 'error'>('loading');
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
      } catch (e) {
        if (cancelled) return;
        // No legacy fallback: the simulated /api/agents registry was deleted.
        // Surface the failure honestly — an unreachable catalog must never
        // silently render fake data.
        setError((e as Error).message);
        setMode('error');
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
              : 'The omp agent catalog is unreachable.'
        }
        actions={
          mode === 'omp' ? (
            <span className="search" style={{ width: 260 }}>
              <span className="search-icon">
                <Icon name="search" size={14} />
              </span>
              <input
                className="input"
                placeholder="Search name, description or path…"
                aria-label="Search agents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
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
                  <div key={a.name} className={`card card-ghost${isSel ? ' is-selected' : ''}`}>
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
    </>
  );
}
