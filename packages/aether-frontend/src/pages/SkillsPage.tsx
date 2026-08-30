import React, { useCallback, useEffect, useState } from 'react';
import { listOmpSkills, listSkills, type SkillRecord } from '../lib/api';
import {
  Card,
  ConfirmButton,
  EmptyState,
  Icon,
  PageHeader,
  StatusPill,
  fmtRelative,
  type StatusTone,
} from '../components/ui';

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

/** Source → pill tone. Namespaced sources (e.g. `omp:managed`) key off their last
 *  segment: omp-managed reads info, user-authored ok, the rest idle. */
function sourceTone(source: string): StatusTone {
  switch (source.split(':').pop()) {
    case 'user':
      return 'ok';
    case 'project':
    case 'managed':
    case 'managed-skills':
      return 'info';
    default:
      // bundled / legacy / unknown — neutral, never error
      return 'idle';
  }
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--s-2)',
};

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

  const clearEditing = () => {
    setEditing(null);
    setName('');
    setDescription('');
    setBody('');
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
      <PageHeader
        title="Skills"
        subtitle={
          <>
            {source === 'omp' ? 'omp facade' : 'legacy endpoint'} · {filtered.length} of{' '}
            {skills.length} discovered · {drafts.length} local draft{drafts.length === 1 ? '' : 's'}
          </>
        }
        actions={
          <button className="btn" style={iconBtn} onClick={refresh}>
            <Icon name="refresh" size={14} />
            Refresh
          </button>
        }
      />

      <div className="stack">
        {error && (
          <div className="error-state" role="alert">
            <span className="muted" style={{ flex: 1 }}>
              {error}
            </span>
            <button className="btn sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {fallback && (
          <div className="card">
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <StatusPill tone="warn" dot>
                fallback
              </StatusPill>
              <span className="muted" style={{ flex: 1, fontSize: 12 }}>
                {fallback}
              </span>
              <button className="btn sm" onClick={() => setFallback(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        {warnings && (
          <div className="card">
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <StatusPill tone="warn" dot>
                warnings
              </StatusPill>
              <span className="muted" style={{ flex: 1, fontSize: 12 }}>
                {warnings}
              </span>
            </div>
          </div>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 360px) 1fr' }}>
          <Card title={editing !== null ? 'Edit draft' : 'Draft a skill'}>
            <div className="stack">
              <div className="field">
                <label htmlFor="skill-draft-name">Name</label>
                <input
                  id="skill-draft-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="my-useful-skill"
                />
              </div>
              <div className="field">
                <label htmlFor="skill-draft-desc">Description</label>
                <input
                  id="skill-draft-desc"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="skill-draft-body">Body (markdown)</label>
                <textarea
                  id="skill-draft-body"
                  className="textarea"
                  style={{ minHeight: 180 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
              <div className="row">
                <button className="btn primary" style={iconBtn} onClick={saveDraft}>
                  <Icon name="plus" size={14} />
                  {editing !== null ? 'Save draft' : 'Create (save draft)'}
                </button>
                {editing !== null && (
                  <button className="btn ghost" onClick={clearEditing}>
                    Cancel
                  </button>
                )}
              </div>
              {draftNote && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {draftNote}
                </div>
              )}
              {drafts.length > 0 && (
                <div className="stack" style={{ gap: 'var(--s-2)' }}>
                  <div className="muted" style={{ fontSize: 11 }}>
                    Local drafts ({drafts.length}) — saved in this browser only
                  </div>
                  {drafts.map((d, i) => (
                    <div
                      key={`${d.savedAt}-${i}`}
                      className="card-ghost"
                      style={{
                        padding: 'var(--s-2) var(--s-3)',
                        borderRadius: 'var(--r-md)',
                        textAlign: 'left',
                      }}
                    >
                      <div className="row" style={{ gap: 'var(--s-2)' }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                        <span className="mono muted" style={{ fontSize: 11 }}>
                          {fmtRelative(d.savedAt)}
                        </span>
                        <button className="btn sm" onClick={() => loadDraft(i)}>
                          Load
                        </button>
                        <ConfirmButton onConfirm={() => deleteDraft(i)} title="Delete draft">
                          Delete
                        </ConfirmButton>
                      </div>
                      {d.description && (
                        <div
                          className="muted clamp-2"
                          style={{ fontSize: 11, marginTop: 4 }}
                          title={d.description}
                        >
                          {d.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card
            title={`Discovered (${filtered.length}${q ? ` / ${skills.length}` : ''})`}
            actions={
              <StatusPill tone={source === 'omp' ? 'info' : 'idle'} dot>
                {source === 'omp' ? 'omp skills' : 'legacy skills'}
              </StatusPill>
            }
          >
            <div className="stack">
              <span className="search">
                <span className="search-icon">
                  <Icon name="search" size={14} />
                </span>
                <input
                  className="input"
                  aria-label="Search skills by name or description"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or description…"
                />
              </span>

              {filtered.length === 0 ? (
                <EmptyState
                  icon="skills"
                  title={q ? 'No skills match' : 'No skills discovered'}
                  message={
                    q ? (
                      <>
                        Nothing matches “{query.trim()}” in the loaded {source} skills.
                      </>
                    ) : (
                      'Drop a SKILL.md pack under .omp/skills/<name>/SKILL.md in the project, or ~/.omp/agent/skills/.'
                    )
                  }
                  action={
                    q ? (
                      <button className="btn" onClick={() => setQuery('')}>
                        Clear search
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="stack" style={{ gap: 'var(--s-2)' }}>
                  {filtered.map((s, i) => {
                    const open = expanded === s.name || expanded === s.path;
                    return (
                      <div
                        key={`${s.path}:${s.name}`}
                        className="card-ghost"
                        style={{ overflow: 'hidden', borderRadius: 'var(--r-md)' }}
                      >
                        <button
                          type="button"
                          className="list-row"
                          aria-expanded={open}
                          aria-controls={`skill-body-${i}`}
                          onClick={() =>
                            setExpanded(open ? null : expanded === s.name ? s.path : s.name)
                          }
                        >
                          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                          <span className="list-row-main">
                            <span
                              className="mono"
                              style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}
                            >
                              {s.name}
                            </span>
                            <span
                              className="muted clamp-2"
                              style={{ fontSize: 'var(--fs-xs)' }}
                              title={s.description}
                            >
                              {s.description}
                            </span>
                          </span>
                          {/* Source metadata trails on the same line (right-aligned),
                              keeping the row at its clamp-2 height. */}
                          <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                            <StatusPill tone={sourceTone(s.source)}>
                              {s.source.replace(':', ' · ')}
                            </StatusPill>
                          </span>
                        </button>
                        {open && (
                          <div
                            id={`skill-body-${i}`}
                            className="stack"
                            style={{
                              padding: 'var(--s-3)',
                              borderTop: '1px solid var(--hairline)',
                            }}
                          >
                            <div className="mono muted" style={{ fontSize: 11 }}>
                              {s.path}
                            </div>
                            <pre
                              className="code-preview"
                              style={{
                                whiteSpace: 'pre-wrap',
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
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
