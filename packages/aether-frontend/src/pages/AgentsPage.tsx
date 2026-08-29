import React, { useCallback, useEffect, useState } from 'react';
import { listAgents, createAgent, deleteAgent, type AgentRecord } from '../lib/api';

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listAgents()
      .then((r) => setAgents(r.agents))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const add = async () => {
    try {
      await createAgent(name, description ? { description, systemPrompt: description } : undefined);
      setName('');
      setDescription('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const del = async (id: string) => {
    await deleteAgent(id).catch((e) => setError(e.message));
    refresh();
  };

  return (
    <>
      <h2>Agents</h2>
      {error && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}><span className="muted">{error}</span></div>}
      <div className="grid" style={{ gridTemplateColumns: '320px 1fr' }}>
        <div className="card">
          <h3>Register agent</h3>
          <div className="field">
            <label>Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Description / system prompt</label>
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <button className="btn primary" onClick={add}>
            Create
          </button>
        </div>
        <div className="card">
          <h3>Agents ({agents.length})</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>
                    <span className={`tag ${a.status === 'running' ? 'running' : a.status === 'error' ? 'error' : ''}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="mono muted">{new Date(a.createdAt).toLocaleString()}</td>
                  <td>
                    <button className="btn danger" onClick={() => del(a.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No agents registered. Agents use the embedded engine when it is
                    available; run them through Sessions/Loops.
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
