import React, { useEffect, useState } from 'react';
import { listSkills, type SkillRecord } from '../lib/api';

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSkills()
      .then((r) => setSkills(r.skills))
      .catch((e) => setError(e.message));
  }, []);

  const current = skills.find((s) => s.name === selected) ?? null;

  return (
    <>
      <h2>Skills</h2>
      {error ? (
        <div className="muted">{error}</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: '300px 1fr' }}>
          <div className="card">
            <h3>Discovered ({skills.length})</h3>
            <div className="stack">
              {skills.map((s) => (
                <button
                  key={s.name}
                  className={`btn ${selected === s.name ? 'primary' : ''}`}
                  style={{ textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                  onClick={() => setSelected(s.name)}
                >
                  <span>{s.name}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {s.description}
                  </span>
                </button>
              ))}
              {skills.length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  No skills found. Drop a <code>SKILL.md</code> pack under{' '}
                  <code>.omp/skills/&lt;name&gt;/SKILL.md</code> in the project, or{' '}
                  <code>~/.omp/agent/skills/</code>.
                </span>
              )}
            </div>
          </div>
          <div className="card">
            <h3>{current ? current.name : 'Select a skill'}</h3>
            {current && (
              <div className="stack">
                <div className="muted">{current.description}</div>
                <div className="muted mono" style={{ fontSize: 11 }}>
                  {current.path}
                </div>
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
                  {current.body}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
