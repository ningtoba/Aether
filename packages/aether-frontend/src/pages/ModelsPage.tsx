/**
 * Models — grouped model catalog served by the embedded engine (/api/models).
 * One Card per provider; token/context numbers are compacted (full value in title).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { listModels, type ModelGroup } from '../lib/api';
import {
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusPill,
  fmtCompact,
} from '../components/ui';

export function ModelsPage() {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
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
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="Search model id, name or URL…"
              aria-label="Search models"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
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
            actions={<StatusPill tone="idle">{group.models.length} models</StatusPill>}
          >
            <div style={{ maxHeight: 440, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Context window</th>
                    <th>Max tokens</th>
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
