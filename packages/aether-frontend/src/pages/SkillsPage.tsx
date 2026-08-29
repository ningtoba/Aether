import React, { useCallback, useEffect, useState } from 'react';
import { listOmpSkills, listSkills, type SkillRecord } from '../lib/api';

interface Draft {
  name: string;
  description: string;
  body: string;
  savedAt: string;
}

const DRAFT_KEY = 'aether:skill-drafts';

function loadDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Draft[]) : [];
  } catch {
    return [];
  }
}

function tagClass(source: string): string {
  switch (source) {
    case 'user':
      return 'running';
    case 'project':
      return 'completed';
    case 'managed':
    case 'managed-skills':
      return 'gated';
    default:
      return '';
  }
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [source, setSource] = useState<'omp' | 'legacy'>('omp');
  const [warnings, setWarnings] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>(loadDrafts);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const refresh = useCallback(() => {
    listOmpSkills()
      .then((r) => {
        setSkills(r.skills);
        setSource('omp');
        setWarnings(r.warnings ?? null);
        setFallback(null);
      })
      .catch((e: Error) => {
        // The omp facade /skills route 501s when the engine isn't running under
        // Bun. Fall back to the legacy skills list rather than failing hard.
        listSkills()
          .then((r) => {
            setSkills(r.skills);
            setSource('legacy');
            setWarnings(null);
            setFallback(
              /501/.test(e.message)
                ? 'Omp skills endpoint is unavailable (engine not running under Bun) — showing the legacy skills list.'
                : `Omp skills endpoint failed (${e.message}) — showing the legacy skills list.`,
            );
          })
          .catch((e2: Error) => setError(e2.message));
      });
  }, []);

  useEffect(refresh, [refresh]);

  const persistDrafts = useCallback((next: Draft[]) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      // localStorage may be unavailable (private mode / quota) — drafts just
      // won't survive a reload; the in-memory list still works this session.
    }
    setDrafts(next);
  }, []);

  const saveDraft = () => {
    if (!name.trim()) {
      setDraftNote('Draft needs a name.');
      return;
    }
    const draft: Draft = {
      name: name.trim(),
      description: description.trim(),
      body,
      savedAt: new Date().toISOString(),
    };
    const next = [...drafts];
    if (editing !== null && next[editing]) {
      next[editing] = draft;
    } else {
      next.push(draft);
    }
    persistDrafts(next);
    setEditing(null);
    setName('');
    setDescription('');
    setBody('');
    setDraftNote(
      'Create flow lands next iteration — draft saved locally only. ' +
        'No skill endpoint exists yet, so nothing was written to disk.',
    );
  };

  const loadDraft = (i: number) => {
    const d = drafts[i];
    if (!d) return;
    setName(d.name);
    setDescription(d.description);
    setBody(d.body);
    setEditing(i);
    setDraftNote('Loaded draft into the form. Edit and save to update it.');
  };

  const deleteDraft = (i: number) => {
    persistDrafts(drafts.filter((_, idx) => idx !== i));
    if (editing === i) {
      setEditing(null);
      setName('');
      setDescription('');
      setBody('');
    }
    setDraftNote(null);
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? skills.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
    : skills;

  return (
    <>
      <h2>Skills</h2>
      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}>
          <div className="row">
            <span className="muted" style={{ flex: 1 }}>
              {error}
            </span>
            <button className="btn" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {fallback && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row">
            <span className="muted" style={{ flex: 1 }}>
              {fallback}
            </span>
            <button className="btn" onClick={() => setFallback(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {warnings && (
        <div className="card" style={{ marginBottom: 12 }}>
          <span className="muted">{warnings}</span>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: '320px 1fr' }}>
        <div className="card">
          <h3>{editing !== null ? 'Edit draft' : 'Draft a skill'}</h3>
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-useful-skill"
            />
          </div>
          <div className="field">
            <label>Description</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Body (markdown)</label>
            <textarea
              className="textarea"
              style={{ minHeight: 180 }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="row">
            <button className="btn primary" onClick={saveDraft}>
              {editing !== null ? 'Save draft' : 'Create (save draft)'}
            </button>
            {editing !== null && (
              <button
                className="btn"
                onClick={() => {
                  setEditing(null);
                  setName('');
                  setDescription('');
                  setBody('');
                  setDraftNote(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
          {draftNote && (
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              {draftNote}
            </div>
          )}
          {drafts.length > 0 && (
            <div className="stack" style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 11 }}>
                Local drafts ({drafts.length}) — saved in this browser only
              </div>
              {drafts.map((d, i) => (
                <div key={`${d.savedAt}-${i}`} className="card" style={{ padding: 10, margin: 0 }}>
                  <div className="row">
                    <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                    <button className="btn" onClick={() => loadDraft(i)}>
                      Load
                    </button>
                    <button className="btn danger" onClick={() => deleteDraft(i)}>
                      Delete
                    </button>
                  </div>
                  {d.description && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {d.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0, flex: 1 }}>
                Discovered ({filtered.length}
                {q ? ` / ${skills.length}` : ''})
              </h3>
              <span className={`tag ${source === 'omp' ? 'completed' : 'gated'}`}>
                {source === 'omp' ? 'omp skills' : 'legacy skills'}
              </span>
            </div>
            <input
              className="input"
              style={{ marginBottom: 12 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or description…"
            />
            <div className="stack">
              {filtered.map((s) => {
                const open = expanded === s.name || expanded === s.path;
                return (
                  <div
                    key={`${s.path}:${s.name}`}
                    className="card"
                    style={{ margin: 0, padding: 0, overflow: 'hidden' }}
                  >
                    <button
                      className="btn"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 4,
                        width: '100%',
                        borderRadius: 0,
                        background: 'transparent',
                        border: 'none',
                        borderBottom: open ? '1px solid var(--border)' : 'none',
                        padding: 12,
                      }}
                      onClick={() =>
                        setExpanded(open ? null : expanded === s.name ? s.path : s.name)
                      }
                    >
                      <span className="row" style={{ gap: 8 }}>
                        <strong>{s.name}</strong>
                        <span className={`tag ${tagClass(s.source)}`}>{s.source}</span>
                        <span className="spacer" />
                        <span className="muted" style={{ fontSize: 11 }}>
                          {open ? 'collapse' : 'expand'}
                        </span>
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {s.description}
                      </span>
                    </button>
                    {open && (
                      <div className="stack" style={{ padding: 12 }}>
                        <div className="muted mono" style={{ fontSize: 11 }}>
                          {s.path}
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
                            margin: 0,
                          }}
                        >
                          {s.body}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {q
                    ? 'No skills match your search.'
                    : 'No skills found. Drop a SKILL.md pack under .omp/skills/<name>/SKILL.md in the project, or ~/.omp/agent/skills/.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
