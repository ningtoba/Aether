/**
 * Providers — live omp provider catalog (/api/omp/providers).
 * Keys are stored/removed server-side (omp AuthStorage), custom providers are
 * written to ~/.omp/agent/models.yml, and any provider can be verified against
 * its base URL. The browser never keeps a credential: key inputs are cleared
 * the moment they are saved, and no response ever carries a key back.
 */
import React, { Fragment, useCallback, useEffect, useState } from 'react';
import {
  createFacadeProvider,
  deleteFacadeProvider,
  getFacadeStatus,
  listFacadeProviders,
  removeProviderKey,
  setProviderKey,
  verifyProvider,
  type CreateFacadeProviderBody,
  type FacadeProvider,
  type FacadeProviderModelSpec,
  type FacadeStatus,
  type VerifyProviderResult,
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

/** One editable row of the optional models table in the create form. */
interface ModelRowDraft {
  id: string;
  contextWindow: string;
  maxTokens: string;
}

const EMPTY_ROW: ModelRowDraft = { id: '', contextWindow: '', maxTokens: '' };

/** What the row-level verify button keeps per provider id. */
interface VerifyBadge {
  reachable: boolean;
  reason?: string;
}

export function ProvidersPage() {
  const [status, setStatus] = useState<FacadeStatus | null>(null);
  const [providers, setProviders] = useState<FacadeProvider[]>([]);

  // Create-custom-provider form (writes models.yml through the backend).
  const [name, setName] = useState('');
  const [apiStyle, setApiStyle] = useState('openai-completions');
  const [customStyle, setCustomStyle] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyless, setKeyless] = useState(false);
  const [modelRows, setModelRows] = useState<ModelRowDraft[]>([EMPTY_ROW]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [jump, setJump] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Row actions: inline key editor + per-provider verify badges.
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifies, setVerifies] = useState<Record<string, VerifyBadge>>({});

  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineAvailable = status?.available === true;

  const reloadCatalog = useCallback(async () => {
    try {
      const r = await listFacadeProviders();
      setProviders(r.providers);
      setCatalogErr(null);
    } catch (e) {
      setCatalogErr((e as Error).message);
    }
  }, []);

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
        setError(null);
      })
      .catch((e: Error) => setCatalogErr(e.message))
      .finally(() => setCatalogLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  /* ── create form ───────────────────────────────────────────────────── */

  const setRow = (idx: number, patch: Partial<ModelRowDraft>) =>
    setModelRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const createProvider = async () => {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('A provider name is required.');
      if (!baseUrl.trim()) throw new Error('A base URL is required.');
      if (apiStyle === 'custom' && !customStyle.trim())
        throw new Error('Enter a custom API style (e.g. openai-completions).');
      const models: FacadeProviderModelSpec[] = [];
      for (const row of modelRows) {
        const id = row.id.trim();
        if (!id) continue; // blank rows are simply not sent
        const spec: FacadeProviderModelSpec = { id };
        const ctx = row.contextWindow.trim();
        if (ctx) {
          const n = Number(ctx);
          if (!Number.isInteger(n) || n <= 0)
            throw new Error(`Model "${id}": context window must be a positive integer.`);
          spec.contextWindow = n;
        }
        const max = row.maxTokens.trim();
        if (max) {
          const n = Number(max);
          if (!Number.isInteger(n) || n <= 0)
            throw new Error(`Model "${id}": max tokens must be a positive integer.`);
          spec.maxTokens = n;
        }
        models.push(spec);
      }
      const key = apiKey.trim();
      // Mirrors the server rule: declared models need a key unless keyless mode.
      if (!keyless && models.length > 0 && !key)
        throw new Error(
          'An API key is required when the provider declares models — or enable keyless mode.',
        );
      const body: CreateFacadeProviderBody = {
        name: trimmedName,
        baseUrl: baseUrl.trim(),
        api: apiStyle === 'custom' ? customStyle.trim() : apiStyle,
        ...(keyless ? { auth: 'none' as const } : key ? { apiKey: key } : {}),
        ...(models.length > 0 ? { models } : {}),
      };
      await createFacadeProvider(body);
      setName('');
      setBaseUrl('');
      setApiKey('');
      setKeyless(false);
      setModelRows([EMPTY_ROW]);
      setNotice(`"${trimmedName}" written to models.yml — verify it from its row below.`);
      await reloadCatalog();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ── row actions ───────────────────────────────────────────────────── */

  const saveKey = async (id: string) => {
    const key = keyDraft.trim();
    if (!key) {
      setError('Enter a key before saving.');
      return;
    }
    try {
      setKeyBusy(true);
      await setProviderKey(id, key);
      setError(null);
      setKeyDraft(''); // the secret is never re-shown after a save
      setKeyFor(null);
      await reloadCatalog();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKeyBusy(false);
    }
  };

  const dropKey = async (id: string) => {
    try {
      await removeProviderKey(id);
      setError(null);
      await reloadCatalog();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const del = async (id: string) => {
    try {
      await deleteFacadeProvider(id);
      setError(null);
      if (expanded === id) setExpanded(null);
      if (keyFor === id) {
        setKeyFor(null);
        setKeyDraft('');
      }
      await reloadCatalog();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runVerify = async (id: string) => {
    setVerifying(id);
    try {
      const r: VerifyProviderResult = await verifyProvider(id);
      setVerifies((v) => ({ ...v, [id]: { reachable: r.reachable, reason: r.reason } }));
    } catch (e) {
      setVerifies((v) => ({ ...v, [id]: { reachable: false, reason: (e as Error).message } }));
    } finally {
      setVerifying(null);
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
        subtitle="Live omp catalog — configure keys and custom providers server-side."
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
            The omp engine is unavailable (it needs the Bun runtime), so keys, custom providers
            and verification are disabled; the catalog below may be stale.
            {status.error ? ` (${status.error})` : ''}
          </span>
        </Card>
      )}

      <div className="grid" style={{ gridTemplateColumns: '320px 1fr', alignItems: 'start' }}>
        <Card title="Add custom provider">
          {!engineAvailable && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Disabled until the engine is back — providers are written to
              ~/.omp/agent/models.yml.
            </div>
          )}
          <div className="field">
            <label htmlFor="pv-name">
              Name <span className="req" aria-hidden="true">*</span>{' '}
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
              API style <span className="key">api</span>
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
              Base URL <span className="req" aria-hidden="true">*</span>{' '}
              <span className="key">baseUrl</span>
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
              disabled={!engineAvailable || keyless}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyless ? '(keyless — auth: none)' : '(optional)'}
            />
            <label
              className="row"
              style={{ gap: 6, marginTop: 6, fontSize: 12, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={keyless}
                disabled={!engineAvailable}
                onChange={(e) => setKeyless(e.target.checked)}
              />
              <span>
                Keyless local server <span className="key">auth: none</span>
              </span>
            </label>
            <span className="help">
              Stored server-side; never echoed back. Required when the provider declares models,
              unless keyless mode is on (local Ollama/vLLM servers).
            </span>
          </div>
          <div className="field">
            <label>
              Models <span className="key">models (optional)</span>
            </label>
            {modelRows.map((row, i) => (
              <span
                key={i}
                className="row"
                style={{ gap: 6, marginBottom: 6, alignItems: 'flex-start' }}
              >
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 0 }}
                  value={row.id}
                  disabled={!engineAvailable}
                  onChange={(e) => setRow(i, { id: e.target.value })}
                  placeholder="model id"
                  aria-label={`Model ${i + 1} id`}
                />
                <input
                  className="input"
                  style={{ width: 84 }}
                  value={row.contextWindow}
                  disabled={!engineAvailable}
                  onChange={(e) => setRow(i, { contextWindow: e.target.value })}
                  placeholder="ctx"
                  title="contextWindow (optional, positive integer)"
                  aria-label={`Model ${i + 1} context window`}
                />
                <input
                  className="input"
                  style={{ width: 84 }}
                  value={row.maxTokens}
                  disabled={!engineAvailable}
                  onChange={(e) => setRow(i, { maxTokens: e.target.value })}
                  placeholder="max"
                  title="maxTokens (optional, positive integer)"
                  aria-label={`Model ${i + 1} max tokens`}
                />
                <button
                  className="btn ghost sm"
                  onClick={() => setModelRows((rows) => rows.filter((_, j) => j !== i))}
                  disabled={!engineAvailable}
                  title={`Remove model row ${i + 1}`}
                  aria-label={`Remove model row ${i + 1}`}
                >
                  <Icon name="trash" size={14} />
                </button>
              </span>
            ))}
            <button
              className="btn sm"
              onClick={() => setModelRows((rows) => [...rows, EMPTY_ROW])}
              disabled={!engineAvailable}
            >
              <Icon name="plus" size={14} /> add model
            </button>
            <span className="help">
              Declaring models makes the provider usable before online discovery. Blank rows are
              ignored.
            </span>
          </div>
          <button
            className="btn primary"
            onClick={() => void createProvider()}
            disabled={!engineAvailable || busy}
            title={
              !engineAvailable ? 'Engine unavailable — start the backend under Bun' : undefined
            }
          >
            {busy ? 'Adding…' : 'Add provider'}
          </button>

          {notice && (
            <div className="stack" style={{ gap: 6, marginTop: 12 }}>
              <StatusPill tone="ok" dot>
                created
              </StatusPill>
              <span className="muted" style={{ fontSize: 12 }}>
                {notice}
              </span>
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
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setJump(''); // free typing supersedes the jump selection
                  }}
                />
              </span>
              <select
                className="select"
                style={{ width: 180, flexShrink: 0 }}
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
                      const vr = verifies[p.id];
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
                              {p.custom && (
                                <div style={{ marginTop: 4 }}>
                                  <StatusPill tone="info">models.yml</StatusPill>
                                </div>
                              )}
                            </td>
                            <td>
                              <StatusPill tone="idle">{p.modelCount}</StatusPill>
                            </td>
                            <td className="mono muted" style={{ maxWidth: 280 }}>
                              <span
                                className="truncate"
                                style={{ maxWidth: 280 }}
                                title={p.baseUrl || undefined}
                              >
                                {p.baseUrl || '—'}
                              </span>
                            </td>
                            <td>
                              <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                                {p.authenticated ? (
                                  <>
                                    <StatusPill tone="ok" dot>
                                      configured
                                    </StatusPill>
                                    {p.authOrigin && (
                                      <StatusPill tone="info">via {p.authOrigin}</StatusPill>
                                    )}
                                  </>
                                ) : (
                                  <StatusPill tone="idle">not configured</StatusPill>
                                )}
                                {vr && (
                                  <span title={vr.reason || undefined}>
                                    <StatusPill tone={vr.reachable ? 'ok' : 'error'} dot>
                                      {vr.reachable ? 'reachable' : 'unreachable'}
                                    </StatusPill>
                                  </span>
                                )}
                              </span>
                            </td>
                            <td>
                              {p.discoverable ? (
                                <span title={p.discoveryStatus || undefined}>
                                  <StatusPill tone="info">discoverable</StatusPill>
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td>
                              <span
                                className="row"
                                style={{
                                  gap: 6,
                                  flexWrap: 'wrap',
                                  justifyContent: 'flex-end',
                                  // Buttons must never shrink-clip their labels
                                  // ("model"/"veril"); the cluster keeps its natural
                                  // width and the table's overflow:auto wrapper gains
                                  // a real horizontal scroll instead.
                                  width: 'max-content',
                                  marginLeft: 'auto',
                                }}
                              >
                                {p.modelCount > 0 && (
                                  <button
                                    className="btn sm"
                                    onClick={() => setExpanded(open ? null : p.id)}
                                    title={
                                      open
                                        ? `Hide ${p.modelCount} models`
                                        : `Show ${p.modelCount} models`
                                    }
                                  >
                                    {open ? 'hide' : 'models'}
                                  </button>
                                )}
                                <button
                                  className="btn sm"
                                  disabled={!engineAvailable || keyBusy}
                                  title={
                                    p.authenticated
                                      ? `Replace the stored key for ${p.name}`
                                      : `Store a key for ${p.name}`
                                  }
                                  onClick={() => {
                                    setKeyFor(keyFor === p.id ? null : p.id);
                                    setKeyDraft('');
                                  }}
                                >
                                  {p.authenticated ? 'key' : 'set key'}
                                </button>
                                {p.authenticated && (
                                  <ConfirmButton
                                    title={`Remove the stored key for ${p.name}`}
                                    onConfirm={() => void dropKey(p.id)}
                                  >
                                    revoke
                                  </ConfirmButton>
                                )}
                                <button
                                  className="btn sm"
                                  disabled={!engineAvailable || verifying !== null}
                                  title={`Probe ${p.name} /models`}
                                  onClick={() => void runVerify(p.id)}
                                >
                                  {verifying === p.id ? 'verifying…' : 'verify'}
                                </button>
                                {p.custom && (
                                  <ConfirmButton
                                    title={`Delete ${p.name} from models.yml`}
                                    onConfirm={() => void del(p.id)}
                                  >
                                    delete
                                  </ConfirmButton>
                                )}
                              </span>
                            </td>
                          </tr>
                          {keyFor === p.id && (
                            <tr>
                              <td colSpan={6} style={{ padding: '2px 10px 10px' }}>
                                <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                                  <input
                                    className="input"
                                    type="password"
                                    style={{ maxWidth: 320 }}
                                    placeholder={`API key for ${p.name}`}
                                    aria-label={`API key for ${p.name}`}
                                    value={keyDraft}
                                    onChange={(e) => setKeyDraft(e.target.value)}
                                  />
                                  <button
                                    className="btn primary sm"
                                    disabled={keyBusy}
                                    onClick={() => void saveKey(p.id)}
                                  >
                                    {keyBusy ? 'Saving…' : 'Save key'}
                                  </button>
                                  <button
                                    className="btn ghost sm"
                                    onClick={() => {
                                      setKeyFor(null);
                                      setKeyDraft('');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <span className="muted" style={{ fontSize: 12 }}>
                                    Stored server-side; never echoed back.
                                  </span>
                                </span>
                              </td>
                            </tr>
                          )}
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
        </div>
      </div>
    </>
  );
}
