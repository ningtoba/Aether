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
import {
  Card,
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  StatusPill,
} from '../components/ui';

const API_STYLES = ['openai-completions', 'chat-completions', 'anthropic', 'google'];

const REQUIRED: React.CSSProperties = { color: 'var(--error)' };

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

  const [catalogLoading, setCatalogLoading] = useState(true);

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
    setCatalogLoading(true);
    listFacadeProviders()
      .then((r) => {
        setProviders(r.providers);
        setCatalogErr(null);
      })
      .catch((e: Error) => setCatalogErr(e.message))
      .finally(() => setCatalogLoading(false));
    listProviders()
      .then((r) => {
        setLegacy(r.providers);
        setError(null);
      })
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
      <PageHeader
        title="Providers"
        subtitle="Live omp catalog plus the legacy configured-provider registry."
        actions={
          status === null ? (
            <StatusPill tone="idle" dot>
              checking engine…
            </StatusPill>
          ) : engineAvailable ? (
            <StatusPill tone="info" dot>
              omp engine{status.version ? ` v${status.version}` : ''}
            </StatusPill>
          ) : (
            <StatusPill tone="warn" dot>
              engine unavailable
            </StatusPill>
          )
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}

      {status && !engineAvailable && (
        <Card>
          <span className="muted">
            The omp engine is unavailable (it needs the Bun runtime), so live provider discovery is
            off and the add form below is disabled. The legacy configured list still works.
            {status.error ? ` (${status.error})` : ''}
          </span>
        </Card>
      )}

      <div className="grid" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
        <Card title="Add custom provider">
          {!engineAvailable && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Disabled until the engine is back — save, then verify against the omp catalog.
            </div>
          )}
          <div className="field">
            <label htmlFor="pv-name">
              Name <span style={REQUIRED} aria-hidden="true">*</span>{' '}
              <span className="key">name</span>
            </label>
            <input
              id="pv-name"
              className="input"
              value={name}
              disabled={!engineAvailable}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-gpu-server"
            />
          </div>
          <div className="field">
            <label htmlFor="pv-style">
              API style <span className="key">type</span>
            </label>
            <select
              id="pv-style"
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
                aria-label="Custom API style"
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="pv-url">
              Base URL <span style={REQUIRED} aria-hidden="true">*</span>{' '}
              <span className="key">endpoint</span>
            </label>
            <input
              id="pv-url"
              className="input"
              value={baseUrl}
              disabled={!engineAvailable}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="field">
            <label htmlFor="pv-key">
              API key <span className="key">apiKey</span>
            </label>
            <input
              id="pv-key"
              className="input"
              type="password"
              value={apiKey}
              disabled={!engineAvailable}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="(optional)"
            />
            <span className="help">Stored server-side by the legacy registry; never echoed back.</span>
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
            <div className="stack" style={{ gap: 6, marginTop: 12 }}>
              {verify.found && verify.modelCount > 0 && (
                <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <StatusPill tone="ok" dot>
                    reachable
                  </StatusPill>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {verify.name} is reachable in the catalog with {verify.modelCount} model
                    {verify.modelCount === 1 ? '' : 's'}.
                  </span>
                </span>
              )}
              {verify.found && verify.modelCount === 0 && (
                <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <StatusPill tone="warn" dot>
                    no models
                  </StatusPill>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {verify.name} registered but the catalog reports 0 models — check the base URL
                    and API style.
                  </span>
                </span>
              )}
              {!verify.found && (
                <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <StatusPill tone="error" dot>
                    not found
                  </StatusPill>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {verify.name} was saved but not found in the omp catalog — it may not be
                    discoverable, or the engine needs a restart to pick it up.
                  </span>
                </span>
              )}
            </div>
          )}
        </Card>

        <div className="stack">
          <Card
            title={`Every provider (${providers.length})`}
            actions={
              <span className="mono muted" style={{ fontSize: 11 }}>
                via /api/omp/providers
              </span>
            }
          >
            {catalogErr && (
              <div style={{ marginBottom: 10 }}>
                <ErrorState message={`Catalog unavailable: ${catalogErr}`} onRetry={refresh} />
              </div>
            )}
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="search" style={{ flex: 1 }}>
                <span className="search-icon">
                  <Icon name="search" size={14} />
                </span>
                <input
                  className="input"
                  placeholder="Search providers…"
                  aria-label="Search providers"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </span>
              <select
                className="select"
                aria-label="Jump to provider"
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

            {catalogLoading && providers.length === 0 && <Skeleton rows={6} />}

            {!catalogLoading && filtered.length === 0 && (
              <EmptyState
                icon="providers"
                title={providers.length === 0 ? 'No providers in the catalog' : 'No providers match'}
                message={
                  providers.length === 0
                    ? 'The catalog comes from the omp model registry (~/.omp/agent/models.yml + installed providers).'
                    : 'Try a different search term, or clear the jump-to selection.'
                }
                action={
                  q ? (
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setQuery('');
                        setJump('');
                      }}
                    >
                      Clear search
                    </button>
                  ) : undefined
                }
              />
            )}

            {filtered.length > 0 && (
              <div style={{ overflow: 'auto', maxHeight: 440 }}>
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
                              <div style={{ fontWeight: 600 }}>{p.name}</div>
                              {p.id !== p.name && (
                                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                                  <span className="mono muted" style={{ fontSize: 11 }}>
                                    {p.id}
                                  </span>
                                  <CopyButton text={p.id} title="Copy provider id" />
                                </div>
                              )}
                            </td>
                            <td>
                              <StatusPill tone="idle">{p.modelCount}</StatusPill>
                            </td>
                            <td className="mono muted" style={{ maxWidth: 280 }} title={p.baseUrl ?? undefined}>
                              {p.baseUrl ?? '—'}
                            </td>
                            <td>
                              {p.authenticated ? (
                                <StatusPill tone="ok" dot>
                                  configured
                                </StatusPill>
                              ) : (
                                <StatusPill tone="idle">not configured</StatusPill>
                              )}
                            </td>
                            <td>
                              {p.discoverable ? (
                                <StatusPill tone="info">discoverable</StatusPill>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td>
                              {p.modelCount > 0 && (
                                <button
                                  className="btn sm"
                                  onClick={() => setExpanded(open ? null : p.id)}
                                >
                                  {open ? 'collapse' : `models (${p.modelCount})`}
                                </button>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={6} style={{ padding: '2px 10px 12px' }}>
                                <pre
                                  className="code-preview"
                                  style={{ margin: 0, maxHeight: 240, overflowY: 'auto' }}
                                >
                                  {samples.join('\n')}
                                  {p.modelCount - samples.length > 0
                                    ? `\n+${p.modelCount - samples.length} more`
                                    : ''}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {legacy.length > 0 && (
            <Card title={`Configured (legacy) (${legacy.length})`}>
              <div style={{ overflow: 'auto', maxHeight: 440 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Endpoint</th>
                      <th>API key</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {legacy.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <span className="mono">{p.id}</span>
                            <CopyButton text={p.id} title="Copy provider id" />
                          </div>
                        </td>
                        <td style={{ fontWeight: 600 }}>{p.name}</td>
                        <td>
                          <StatusPill tone="idle">{p.type}</StatusPill>
                        </td>
                        <td className="mono muted" style={{ maxWidth: 280 }} title={p.endpoint ?? undefined}>
                          {p.endpoint ?? '—'}
                        </td>
                        <td>
                          {p.apiKeyConfigured ? (
                            <StatusPill tone="ok" dot>
                              configured
                            </StatusPill>
                          ) : (
                            <StatusPill tone="idle">not configured</StatusPill>
                          )}
                        </td>
                        <td>
                          <ConfirmButton
                            title={`Remove ${p.name}`}
                            onConfirm={() => void del(p.id)}
                          >
                            Remove
                          </ConfirmButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
