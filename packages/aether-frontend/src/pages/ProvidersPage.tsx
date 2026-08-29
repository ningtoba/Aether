/**
 * Providers — omp provider catalog + legacy custom-provider manager.
 * Shows every provider the embedded omp engine knows (/api/omp/providers)
 * alongside the legacy configured list (/api/providers), and lets you add a
 * custom provider through the legacy route then re-scan the catalog to verify.
 */
import React, { Fragment, useCallback, useEffect, useState } from 'react';
import {
  getFacadeStatus,
  listProviders,
  addProvider,
  removeProvider,
  listFacadeProviders,
  type FacadeStatus,
  type FacadeProvider,
  type ProviderRecord,
} from '../lib/api';

const API_STYLES = ['openai-completions', 'chat-completions', 'anthropic', 'google'];

export function ProvidersPage() {
  const [status, setStatus] = useState<FacadeStatus | null>(null);
  const [providers, setProviders] = useState<FacadeProvider[]>([]);
  const [legacy, setLegacy] = useState<ProviderRecord[]>([]);

  const [name, setName] = useState('');
  const [apiStyle, setApiStyle] = useState('openai-completions');
  const [customStyle, setCustomStyle] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [jump, setJump] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ name: string; found: boolean; modelCount: number } | null>(
    null,
  );

  const engineAvailable = status?.available === true;

  const refresh = useCallback(() => {
    getFacadeStatus()
      .then((r) => setStatus(r.status))
      .catch(() =>
        setStatus({ available: false, runtime: 'node', capabilities: [], error: undefined }),
      );
    listFacadeProviders()
      .then((r) => {
        setProviders(r.providers);
        setCatalogErr(null);
      })
      .catch((e: Error) => setCatalogErr(e.message));
    listProviders()
      .then((r) => setLegacy(r.providers))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const del = async (id: string) => {
    try {
      await removeProvider(id);
      setError(null);
      const r = await listProviders();
      setLegacy(r.providers);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveAndVerify = async () => {
    try {
      setBusy(true);
      setError(null);
      setVerify(null);
      if (!name.trim()) throw new Error('A provider name is required.');
      if (!baseUrl.trim()) throw new Error('A base URL is required.');
      const type = apiStyle === 'custom' ? customStyle.trim() || 'custom' : apiStyle;
      await addProvider({
        name: name.trim(),
        type,
        endpoint: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      // No per-provider fetch-models endpoint exists — verify by re-reading the
      // full omp catalog and checking whether the saved provider shows models.
      const cat = await listFacadeProviders();
      setProviders(cat.providers);
      setCatalogErr(null);
      const found = cat.providers.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
      setVerify({ name: name.trim(), found: !!found, modelCount: found?.modelCount ?? 0 });
      setName('');
      setBaseUrl('');
      setApiKey('');
      setCustomStyle('');
      const r = await listProviders();
      setLegacy(r.providers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? providers.filter((p) =>
        [p.name, p.id, p.baseUrl ?? ''].some((s) => s.toLowerCase().includes(q)),
      )
    : providers;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Providers</h2>
        {status === null ? (
          <span className="tag">checking engine…</span>
        ) : engineAvailable ? (
          <span className="tag running">
            omp engine{status.version ? ` v${status.version}` : ''}
          </span>
        ) : (
          <span className="tag gated">engine unavailable</span>
        )}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}>
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {status && !engineAvailable && (
        <div className="card" style={{ marginBottom: 12 }}>
          <span className="muted">
            The omp engine is unavailable (it needs the Bun runtime), so live provider discovery is
            off and the add form below is disabled. The legacy configured list still works.
            {status.error ? ` (${status.error})` : ''}
          </span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '320px 1fr' }}>
        <div className="card">
          <h3>Add custom provider</h3>
          {!engineAvailable && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Disabled until the engine is back — save, then verify against the omp catalog.
            </div>
          )}
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              value={name}
              disabled={!engineAvailable}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-gpu-server"
            />
          </div>
          <div className="field">
            <label>API style</label>
            <select
              className="select"
              value={apiStyle}
              disabled={!engineAvailable}
              onChange={(e) => setApiStyle(e.target.value)}
            >
              {API_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="custom">custom…</option>
            </select>
            {apiStyle === 'custom' && (
              <input
                className="input"
                style={{ marginTop: 6 }}
                value={customStyle}
                disabled={!engineAvailable}
                onChange={(e) => setCustomStyle(e.target.value)}
                placeholder="e.g. vllm"
              />
            )}
          </div>
          <div className="field">
            <label>Base URL</label>
            <input
              className="input"
              value={baseUrl}
              disabled={!engineAvailable}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="field">
            <label>API key</label>
            <input
              className="input"
              type="password"
              value={apiKey}
              disabled={!engineAvailable}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="(optional)"
            />
          </div>
          <button
            className="btn primary"
            onClick={saveAndVerify}
            disabled={!engineAvailable || busy}
            title={
              !engineAvailable ? 'Engine unavailable — start the backend under Bun' : undefined
            }
          >
            {busy ? 'Saving…' : 'Save & verify'}
          </button>

          {verify && (
            <div className="stack" style={{ gap: 4, marginTop: 12 }}>
              {verify.found && verify.modelCount > 0 && (
                <span style={{ color: 'var(--green)', fontSize: 12 }}>
                  ✓ {verify.name} is live in the catalog with {verify.modelCount} model
                  {verify.modelCount === 1 ? '' : 's'}.
                </span>
              )}
              {verify.found && verify.modelCount === 0 && (
                <span style={{ color: 'var(--yellow)', fontSize: 12 }}>
                  {verify.name} registered but the catalog reports 0 models — check the base URL and
                  API style.
                </span>
              )}
              {!verify.found && (
                <span style={{ color: 'var(--red)', fontSize: 12 }}>
                  {verify.name} was saved but not found in the omp catalog — it may not be
                  discoverable, or the engine needs a restart to pick it up.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Every provider ({providers.length})</h3>
              <div className="spacer" />
              <span className="muted" style={{ fontSize: 11 }}>
                via /api/omp/providers
              </span>
            </div>
            {catalogErr && (
              <div className="row" style={{ marginBottom: 10, gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Catalog unavailable: {catalogErr}
                </span>
                <button className="btn" onClick={() => setCatalogErr(null)}>
                  dismiss
                </button>
              </div>
            )}
            <div className="row" style={{ marginBottom: 10 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Search providers…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className="select"
                value={jump}
                onChange={(e) => {
                  setJump(e.target.value);
                  setQuery(e.target.value);
                }}
              >
                <option value="">jump to…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Models</th>
                  <th>Base URL</th>
                  <th>Auth</th>
                  <th>Discoverable</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const open = expanded === p.id;
                  const samples = p.models.slice(0, 10);
                  return (
                    <Fragment key={p.id}>
                      <tr>
                        <td>
                          <div>{p.name}</div>
                          {p.id !== p.name && (
                            <div className="mono muted" style={{ fontSize: 11 }}>
                              {p.id}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="tag">{p.modelCount}</span>
                        </td>
                        <td className="mono muted">{p.baseUrl ?? '—'}</td>
                        <td>
                          {p.authenticated ? (
                            <span className="tag running">authenticated</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {p.discoverable ? (
                            <span className="tag completed">discoverable</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {p.modelCount > 0 && (
                            <button className="btn" onClick={() => setExpanded(open ? null : p.id)}>
                              {open ? 'collapse' : `models (${p.modelCount})`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} style={{ padding: '2px 10px 12px' }}>
                            <div
                              className="mono"
                              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
                            >
                              {samples.map((m) => (
                                <span key={m} className="tag">
                                  {m}
                                </span>
                              ))}
                              {p.modelCount - samples.length > 0 && (
                                <span
                                  className="muted"
                                  style={{ fontSize: 11, alignSelf: 'center' }}
                                >
                                  +{p.modelCount - samples.length} more
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No providers match. The catalog comes from the omp model registry
                      (~/.omp/agent/models.yml + installed providers).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {legacy.length > 0 && (
            <div className="card">
              <h3>Configured (legacy) ({legacy.length})</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Endpoint</th>
                    <th>Key</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {legacy.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <span className="tag">{p.type}</span>
                      </td>
                      <td className="mono muted">{p.endpoint ?? '—'}</td>
                      <td>{p.apiKeyConfigured ? '✓' : '—'}</td>
                      <td>
                        <button className="btn danger" onClick={() => del(p.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
