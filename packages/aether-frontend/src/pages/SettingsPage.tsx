import React, { useEffect, useState } from 'react';
import { getHealth, type HealthStatus } from '../lib/api';

export function SettingsPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [engine, setEngine] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setEngine(h.engine?.available ? 'available' : h.engine?.error ?? '—');
      })
      .catch(() => setEngine('unreachable'));
  }, []);

  const info: Array<[string, string]> = [
    ['Backend version', health?.version ?? '—'],
    ['Uptime', health ? `${health.uptime}s` : '—'],
    ['Engine', engine ?? '…'],
    ['Realtime port', health?.realtime?.port != null ? String(health.realtime.port) : '—'],
    ['Configured providers', String(health?.providers.configured ?? '—')],
  ];

  return (
    <>
      <h2>Settings</h2>
      <div className="card" style={{ maxWidth: 520 }}>
        <h3>Backend</h3>
        <table className="table">
          <tbody>
            {info.map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: 'var(--muted)', width: 180 }}>{k}</td>
                <td className="mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Run the server with <code>bun run packages/aether-backend/src/main.ts</code> (or the
          Docker image). Configure env <code>PORT</code>, <code>HOST</code>,{' '}
          <code>REALTIME_PORT</code>, <code>AETHER_API_KEY</code>. Model catalog comes from the
          omp registry (<code>~/.omp/agent/models.yml</code>).
        </p>
      </div>
    </>
  );
}
