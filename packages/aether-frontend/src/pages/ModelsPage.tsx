/**
 * Models — grouped model catalog served by the embedded engine (/api/models).
 * One Card per provider; token/context numbers are compacted (full value in title).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { listFacadeProviders, listModels, type ModelGroup } from '../lib/api';
import {
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  StatusPill,
  fmtCompact,
} from '../components/ui';

export function ModelsPage() {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  /** provider id → server-side key truth; empty until the provider catalog answers. */
  const [providerAuth, setProviderAuth] = useState<Record<string, boolean>>({});
  const [provider, setProvider] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listModels()
      .then((r) => {
        setGroups(r.groups);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    // Auth truth is best-effort and never blocks the catalog: a group only shows
    // the "not configured" pill once this call has answered for its provider.
    listFacadeProviders()
      .then((r) =>
        setProviderAuth(
          Object.fromEntries(r.providers.map((p) => [p.id, p.authenticated] as const)),
        ),
      )
      .catch(() => setProviderAuth({}));
  }, []);

  useEffect(refresh, [refresh]);

  const q = query.trim().toLowerCase();
  const filtered = (provider === 'all' ? groups : groups.filter((g) => g.provider === provider))
    .map((g) =>
      q
        ? {
            ...g,
            models: g.models.filter((m) =>
              [m.id, m.name, m.baseUrl ?? ''].some((s) => s.toLowerCase().includes(q)),
            ),
          }
        : g,
    )
    .filter((g) => g.models.length > 0);

  const totalModels = groups.reduce((n, g) => n + g.models.length, 0);
  const filtering = q !== '' || provider !== 'all';

  return (
    <>
      <PageHeader
        title="Models"
        subtitle={
          loading && groups.length === 0
            ? 'Loading the engine model catalog…'
            : `${totalModels} model${totalModels === 1 ? '' : 's'} across ${groups.length} provider${groups.length === 1 ? '' : 's'}`
        }
        actions={
          <>
            <span className="search" style={{ width: 260 }}>
              <span className="search-icon">
                <Icon name="search" size={14} />
              </span>
              <input
                className="input"
                placeholder="Search models…"
                aria-label="Search models"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
            <select
              className="select"
              aria-label="Filter by provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="all">All providers ({groups.length})</option>
              {groups.map((g) => (
                <option key={g.provider} value={g.provider}>
                  {g.provider} ({g.models.length})
                </option>
              ))}
            </select>
          </>
        }
      />

      {error && (
        <ErrorState message={`Engine model catalog unavailable: ${error}`} onRetry={refresh} />
      )}

      {!error && loading && groups.length === 0 && <Skeleton rows={6} />}

      {!error && !loading && filtered.length === 0 && (
        <EmptyState
          icon="models"
          title="No models found"
          message={
            filtering
              ? 'No models match the current provider filter or search term.'
              : 'The engine reported an empty model catalog.'
          }
          action={
            filtering ? (
              <button
                className="btn ghost"
                onClick={() => {
                  setQuery('');
                  setProvider('all');
                }}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}

      <div className="stack">
        {filtered.map((group) => (
          <Card
            key={group.provider}
            title={group.provider}
            actions={
              <>
                {providerAuth[group.provider] === false && (
                  <span title="No server-side API key configured">
                    <StatusPill tone="idle">not configured</StatusPill>
                  </span>
                )}
                <span className="mono muted">{group.models.length} models</span>
              </>
            }
          >
            <div style={{ maxHeight: 440, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th className="num">Context window</th>
                    <th className="num">Max tokens</th>
                    <th>Base URL</th>
                  </tr>
                </thead>
                <tbody>
                  {group.models.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          <span className="mono" title={m.name || m.id}>
                            {m.id}
                          </span>
                          <CopyButton text={m.id} title="Copy model id" />
                        </div>
                      </td>
                      <td className="num" title={m.contextWindow.toLocaleString()}>
                        {fmtCompact(m.contextWindow)}
                      </td>
                      <td className="num" title={m.maxTokens.toLocaleString()}>
                        {fmtCompact(m.maxTokens)}
                      </td>
                      <td className="mono muted">
                        <span
                          className="truncate"
                          style={{ maxWidth: 280 }}
                          title={m.baseUrl ?? undefined}
                        >
                          {m.baseUrl ?? '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
