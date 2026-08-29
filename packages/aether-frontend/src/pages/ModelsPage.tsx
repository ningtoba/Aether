import React, { useEffect, useState } from 'react';
import { listModels, type ModelGroup } from '../lib/api';

export function ModelsPage() {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [provider, setProvider] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listModels()
      .then((r) => setGroups(r.groups))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = provider === 'all' ? groups : groups.filter((g) => g.provider === provider);

  return (
    <>
      <h2>Models</h2>
      {error ? (
        <div className="muted">Engine unavailable: {error}</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 16 }}>
            <span className="muted">Provider</span>
            <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="all">All providers</option>
              {groups.map((g) => (
                <option key={g.provider} value={g.provider}>
                  {g.provider} ({g.models.length})
                </option>
              ))}
            </select>
          </div>
          {filtered.map((group) => (
            <div className="card" key={group.provider} style={{ marginBottom: 16 }}>
              <h3>{group.provider}</h3>
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
                      <td className="mono">{m.id}</td>
                      <td>{m.contextWindow}</td>
                      <td>{m.maxTokens}</td>
                      <td className="mono muted">{m.baseUrl ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </>
  );
}
