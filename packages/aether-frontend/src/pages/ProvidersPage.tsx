import React, { useCallback, useEffect, useState } from 'react';
import { listProviders, addProvider, removeProvider, type ProviderRecord } from '../lib/api';

const TYPES = ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'vllm', 'llamacpp', 'custom'];

export function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('openai');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listProviders()
      .then((r) => setProviders(r.providers))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const add = async () => {
    try {
      await addProvider({ name, type, endpoint, apiKey });
      setName('');
      setEndpoint('');
      setApiKey('');
      refresh();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const del = async (id: string) => {
    try {
      await removeProvider(id);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h2>Providers</h2>
      {error && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}><span className="muted">{error}</span></div>}
      <div className="grid" style={{ gridTemplateColumns: '320px 1fr' }}>
        <div className="card">
          <h3>Add provider</h3>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Type</label>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Endpoint</label>
            <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
          </div>
          <div className="field">
            <label>API key</label>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <button className="btn primary" onClick={add}>
            Add
          </button>
        </div>
        <div className="card">
          <h3>Configured ({providers.length})</h3>
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
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.type}</td>
                  <td className="mono muted">{p.endpoint ?? '—'}</td>
                  <td>{p.apiKeyConfigured ? '✓' : '—'}</td>
                  <td>
                    <button className="btn danger" onClick={() => del(p.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    None configured. Note: the embedded engine's model catalog
                    (Sessions/Loops/Models) comes from the omp model registry
                    (~/.omp/agent/models.yml + installed providers), not this list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
