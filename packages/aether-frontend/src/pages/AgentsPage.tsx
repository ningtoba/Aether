import React, { useEffect, useState } from 'react';
import { listOmpAgents, listAgents, type AgentDef, type AgentRecord } from '../lib/api';

type SourceFilter = 'all' | 'bundled' | 'user' | 'project';

const SOURCES: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'bundled', label: 'Bundled' },
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' },
];

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
  const [legacy, setLegacy] = useState<AgentRecord[]>([]);
  const [mode, setMode] = useState<'loading' | 'omp' | 'legacy'>('loading');
  const [source, setSource] = useState<SourceFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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

  const current = filtered.find((a) => a.name === selected) ?? null;
  const currentText = current ? inspectText(current) : '';
  return (
    <>
      <h2>Agents</h2>
      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}>
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {mode === 'loading' && <div className="muted">Loading…</div>}

      {mode === 'omp' && (
        <>
          <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            {SOURCES.map((s) => (
              <button
                key={s.id}
                className={`btn ${source === s.id ? 'primary' : ''}`}
                onClick={() => setSource(s.id)}
              >
                {s.label}
              </button>
            ))}
            <span className="spacer" />
            <input
              className="input"
              placeholder="Search name, description or path…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 260 }}
            />
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
          >
            {filtered.map((a) => (
              <div
                key={a.name}
                className="card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  alignItems: 'flex-start',
                }}
              >
                <div className="row" style={{ width: '100%', flexWrap: 'wrap' }}>
                  <strong>{a.name}</strong>
                  <span className="tag">{a.source}</span>
                  <span className="spacer" />
                  <button
                    className={`btn ${selected === a.name ? 'primary' : ''}`}
                    onClick={() => setSelected(selected === a.name ? null : a.name)}
                  >
                    {selected === a.name ? 'Close' : 'Inspect'}
                  </button>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {a.description || `Bundled ${a.source} agent`}
                </span>
                {a.path && (
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {a.path}
                  </span>
                )}
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="card">
              <span className="muted">
                No agents match this filter.
                {agents.length === 0
                  ? ' The omp engine reported an empty agent catalog.'
                  : ' Try a different source or search term.'}
              </span>
            </div>
          )}

          {current && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3>
                {current.name} <span className="tag">{current.source}</span>
              </h3>
              {current.path && (
                <div className="muted mono" style={{ fontSize: 11, marginBottom: 8 }}>
                  {current.path}
                </div>
              )}
              {currentText ? (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    background: '#0b0f14',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    fontSize: 12.5,
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
            </div>
          )}
        </>
      )}

      {mode === 'legacy' && (
        <>
          <div
            className="card"
            style={{
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <span className="muted" style={{ fontSize: 12 }}>
              The omp agent catalog (bundled + <code>~/.omp/agent/agents/*.md</code> +{' '}
              <code>.omp/agents/*.md</code>) is served by the embedded engine, which is not
              configured on this server (plain-Node backend — the engine needs the Bun runtime).
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              Showing the legacy control-plane agent registry instead.
            </span>
          </div>
          <div className="card">
            <h3>Registered agents ({legacy.length})</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {legacy.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>
                      <span
                        className={`tag ${a.status === 'running' ? 'running' : a.status === 'error' ? 'error' : ''}`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="mono muted">{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {legacy.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      No agents registered. Start the backend under Bun to unlock the real omp agent
                      catalog.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
