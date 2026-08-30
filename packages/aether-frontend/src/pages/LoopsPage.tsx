import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listLoops,
  saveLoop,
  deleteLoop,
  startLoop,
  stopLoop,
  advanceLoop,
  getLoop,
  listModels,
  listSkills,
  listOmpSkills,
  getSession,
  getSessionTranscript,
  type LoopDefinition,
  type LoopProgress,
  type LoopTransition,
  type ModelGroup,
  type SkillRecord,
} from '../lib/api';
import { RealtimeClient, type RealtimeFrame } from '../lib/realtime';
import { ChatConsole } from '../components/ChatConsole';
import type { ChatStats } from '../components/ChatConsole';
import { CwdPicker } from '../components/CwdPicker';
import { reduceChatFrame, appendMeta, fromTranscriptEntries, type ChatItem } from '../lib/chat';
import type { PageId } from '../App';
import {
  Card,
  ConfirmButton,
  CopyButton,
  EmptyState,
  Icon,
  PageHeader,
  StatusPill,
  type StatusTone,
} from '../components/ui';

const EMPTY: Partial<LoopDefinition> = {
  name: 'My loop',
  description: '',
  prompt: 'Improve this project. Round {round}:',
  transition: { kind: 'none' },
};

// Machine default only as the last-resort fallback: once the model catalog
// loads, a selection missing from it is auto-corrected to a real model.
const DEFAULT_MODEL = 'local-server/deepseek-ai/DeepSeek-V4-Flash-0731';

const LOOP_TONE: Record<string, StatusTone> = {
  running: 'running',
  gated: 'warn',
  completed: 'ok',
  stopped: 'idle',
  error: 'error',
  idle: 'idle',
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
}

export function LoopsPage({ onNavigate }: { onNavigate?: (p: PageId) => void }) {
  const [loops, setLoops] = useState<LoopDefinition[]>([]);
  const [progress, setProgress] = useState<Record<string, LoopProgress>>({});
  const [form, setForm] = useState<Partial<LoopDefinition>>({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelGroup[]>([]);
  const [skillOptions, setSkillOptions] = useState<SkillRecord[]>([]);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const eventLogRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [rt, setRt] = useState<RealtimeClient | null>(null);
  /** Loop live-chat inspector: { loopId, sessionId } to stream. */
  const [inspect, setInspect] = useState<{ loopId: string; sessionId?: string } | null>(null);
  const [inspectItems, setInspectItems] = useState<ChatItem[]>([]);
  const [inspectStats, setInspectStats] = useState<ChatStats | null>(null);
  const [loopQuery, setLoopQuery] = useState('');
  const closeInspectRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    listLoops()
      .then((r) => {
        setLoops(r.loops);
        // Populate per-loop progress so the Inspect button / status tags are
        // accurate even on a fresh page load (realtime events only fire for
        // live activity).
        for (const loop of r.loops) {
          getLoop(loop.id)
            .then((d) => {
              const dp = d.progress;
              if (dp) setProgress((m) => ({ ...m, [loop.id]: dp }));
            })
            .catch(() => {});
        }
      })
      .catch((e) => setError(e.message));
    listModels()
      .then((r) => setModels(r.groups))
      .catch(() => {});
    // Skill dropdown: prefer the omp skill facade, fall back to the legacy endpoint.
    listOmpSkills()
      .then((r) => {
        if (r.skills && r.skills.length) setSkillOptions(r.skills);
        else return listSkills().then((s) => setSkillOptions(s.skills));
      })
      .catch(() =>
        listSkills()
          .then((s) => setSkillOptions(s.skills))
          .catch(() => {}),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Once the catalog is loaded, never leave a non-existent model selected —
  // pick the first available one (payload shapes unchanged).
  useEffect(() => {
    const opts = models.flatMap((g) => g.models.map((m) => `${g.provider}/${m.id}`));
    const first = opts[0];
    if (first && !opts.includes(selectedModel)) setSelectedModel(first);
  }, [models, selectedModel]);

  // Discover the realtime port from /health (SessionsPage pattern).
  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then((h) => {
        if (!h?.realtime?.port) return;
        setRt((prev) => prev ?? new RealtimeClient(h.realtime.port));
      })
      .catch(() => {});
  }, []);

  // Live-update loop progress from realtime 'loop' namespace events.
  useEffect(() => {
    if (!rt) return;
    const unsub = rt.subscribe((frame: RealtimeFrame) => {
      if (frame.payload?.namespace !== 'loop') return;
      const ev = frame.payload.event as Record<string, unknown> & {
        kind?: string;
        loopId?: string;
        round?: number;
      };
      const id = typeof ev.loopId === 'string' ? ev.loopId : undefined;
      const kind = typeof ev.kind === 'string' ? ev.kind : '';
      const line = `[${new Date().toISOString().slice(11, 19)}] ${kind}${id ? ' ' + id : ''}${
        typeof ev.round === 'number' ? ' r' + ev.round : ''
      }`;
      setEventLog((l) => [...l.slice(-80), line]);
      if (!id) return;
      if (/round_start|round_end|transition|gated|continue|stop|completed|error/.test(kind)) {
        getLoop(id)
          .then((d) => {
            if (d.progress) setProgress((p) => ({ ...p, [id]: d.progress as LoopProgress }));
          })
          .catch(() => {});
      }
    });
    return unsub;
  }, [rt]);
  // Keep the live event stream pinned to the newest line.
  useEffect(() => {
    eventLogRef.current?.scrollTo({ top: eventLogRef.current.scrollHeight });
  }, [eventLog]);

  // Loop live-chat inspector: stream the loop's session transcript live.
  useEffect(() => {
    if (!rt || !inspect) return;
    const unsub = rt.subscribe((frame: RealtimeFrame) => {
      const sid = frame.payload?.sessionId;
      if (frame.payload?.namespace === 'loop') {
        const ev = frame.payload.event as Record<string, unknown> & {
          kind?: string;
          loopId?: string;
        };
        if (ev.loopId !== inspect.loopId) return;
        const kind = ev.kind ?? '';
        if (/round_start|transition|gated|stop|completed|error/.test(kind)) {
          setInspectItems((it) => appendMeta(it, `── ${kind} ──`));
        }
        return;
      }
      // Only fold session frames when we know which session to watch (the
      // transcript replay covers anything already run). Without a sessionId
      // (never-run loop) ignore all session frames.
      if (!inspect.sessionId || !sid || sid !== inspect.sessionId) return;
      setInspectItems((it) => reduceChatFrame(it, frame));
    });
    return unsub;
  }, [rt, inspect]);

  // Focus management for the inspector dialog: autofocus its Close button so
  // Escape (handled on the overlay) and keyboard use work immediately.
  useEffect(() => {
    if (inspect) closeInspectRef.current?.focus();
  }, [inspect]);

  const openInspect = (loopId: string, sessionId?: string) => {
    setInspect({ loopId, sessionId });
    setInspectStats(null);
    setInspectItems([]);
    // Replay the loop's session transcript — works even for already-completed
    // loops on a fresh page where the progress map isn't loaded yet.
    const loadSession = (sid: string | undefined) => {
      if (!sid) {
        setInspectItems((it) => [
          ...it,
          { id: `meta-${Date.now()}`, kind: 'meta', text: '(no run started yet — press Start)' },
        ]);
        return;
      }
      getSessionTranscript(sid)
        .then((d) => setInspectItems(fromTranscriptEntries(d.transcript.entries)))
        .catch(() => {});
      getSession(sid)
        .then((r) => setInspectStats(r.session.stats ?? null))
        .catch(() => {});
    };
    if (sessionId) {
      loadSession(sessionId);
    } else {
      getLoop(loopId)
        .then((d) => {
          const sid = d.progress?.sessionId;
          setInspect((prev) => (prev ? { ...prev, sessionId: sid } : prev));
          loadSession(sid);
        })
        .catch(() => {});
    }
  };

  const closeInspect = () => {
    setInspect(null);
    setInspectItems([]);
  };

  const modelOptions = models.flatMap((g) => g.models.map((m) => ({ g: g.provider, m })));
  const previewRounds = [1, 2, 3].map((n) => (form.prompt ?? '').replace(/\{round\}/g, String(n)));

  // Client-side filter over the already-loaded saved-loops list only.
  const filteredLoops = useMemo(() => {
    const q = loopQuery.trim().toLowerCase();
    return q
      ? loops.filter((l) =>
          `${l.name} ${l.description ?? ''} ${l.prompt}`.toLowerCase().includes(q),
        )
      : loops;
  }, [loops, loopQuery]);

  const reset = () => {
    setForm({ ...EMPTY });
    setEditingId(null);
  };

  const loadIntoForm = (loop: LoopDefinition) => {
    setForm({
      id: loop.id,
      name: loop.name,
      description: loop.description,
      prompt: loop.prompt,
      transition: { ...loop.transition },
      maxRounds: loop.maxRounds,
      maxTimeMs: loop.maxTimeMs,
    });
    setSelectedModel(`${loop.model.provider}/${loop.model.modelId}`);
    setEditingId(loop.id);
  };

  const save = async () => {
    if (!form.name?.trim() || !form.prompt?.trim()) {
      setError('Name and prompt are required.');
      return;
    }
    const slash = selectedModel.indexOf('/');
    const provider = selectedModel.slice(0, slash);
    const modelId = selectedModel.slice(slash + 1);
    try {
      const { loop } = await saveLoop({ ...form, cwd, model: { provider, modelId } });
      setLoops((l) => [loop, ...l.filter((x) => x.id !== loop.id)]);
      setEditingId(loop.id);
      setForm({ ...EMPTY });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const run = async (id: string) => {
    try {
      const { progress: p } = await startLoop(id);
      setProgress((m) => ({ ...m, [id]: p }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = async (id: string) => {
    try {
      const { progress: p } = await stopLoop(id);
      setProgress((m) => ({ ...m, [id]: p }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const gate = async (id: string, action: 'continue' | 'stop') => {
    try {
      const { progress: p } = await advanceLoop(id, action);
      setProgress((m) => ({ ...m, [id]: p }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const del = async (id: string) => {
    try {
      await deleteLoop(id);
      setLoops((l) => l.filter((x) => x.id !== id));
      setProgress((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      if (editingId === id) {
        setEditingId(null);
        setForm({ ...EMPTY });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Loops"
        subtitle="Round-based autonomous runs with transitions, gates and limits."
      />
      {error && (
        <div
          className="card"
          role="alert"
          style={{ marginBottom: 12, borderColor: 'var(--error)' }}
        >
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>
        {/* Saved-loop list */}
        <Card
          title={`Saved loops (${loops.length})`}
          actions={
            <button className="btn sm" onClick={reset}>
              <Icon name="plus" size={13} /> New
            </button>
          }
        >
          <div style={{ position: 'relative', marginBottom: 'var(--s-2)' }}>
            <span
              style={{
                position: 'absolute',
                left: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-faint)',
                display: 'inline-flex',
                pointerEvents: 'none',
              }}
            >
              <Icon name="search" size={13} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 28 }}
              placeholder="Search loops…"
              aria-label="Search saved loops"
              value={loopQuery}
              onChange={(e) => setLoopQuery(e.target.value)}
            />
          </div>
          <div className="stack">
            {filteredLoops.map((loop) => (
              <div key={loop.id} className="row" style={{ alignItems: 'center' }}>
                <button
                  className="selectable-row"
                  style={{ flex: 1, minWidth: 0, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                  aria-pressed={editingId === loop.id}
                  onClick={() => loadIntoForm(loop)}
                  title={loop.prompt}
                >
                  <span
                    style={{
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 600,
                      fontSize: 12.5,
                    }}
                  >
                    {loop.name}
                  </span>
                  <span
                    className="muted"
                    style={{
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 11,
                    }}
                  >
                    {loop.prompt.length > 42 ? `${loop.prompt.slice(0, 42)}…` : loop.prompt}
                  </span>
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {progress[loop.id]?.status === 'running' && (
                    <StatusPill tone="running" dot>
                      running
                    </StatusPill>
                  )}
                  <ConfirmButton onConfirm={() => del(loop.id)} title={`Delete “${loop.name}”`}>
                    <Icon name="trash" size={13} />
                  </ConfirmButton>
                </div>
              </div>
            ))}
            {filteredLoops.length === 0 &&
              (loops.length === 0 ? (
                <EmptyState
                  icon="loops"
                  title="No saved loops"
                  message="Use New to define your first loop."
                />
              ) : (
                <EmptyState
                  icon="search"
                  title="No matches"
                  message={`Nothing matches “${loopQuery.trim()}”.`}
                  action={
                    <button className="btn ghost sm" onClick={() => setLoopQuery('')}>
                      Clear search
                    </button>
                  }
                />
              ))}
          </div>
        </Card>

        {/* Editor + runners */}
        <div className="stack">
          {/* Identity */}
          <Card
            title={editingId ? 'Edit loop · Identity' : 'Define loop · Identity'}
            actions={
              editingId ? (
                <span className="mono muted" style={{ fontSize: 11 }} title={editingId}>
                  editing {editingId}
                </span>
              ) : undefined
            }
          >
            <div className="field">
              <label htmlFor="loop-name">
                Name <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <input
                id="loop-name"
                className="input"
                value={form.name ?? ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="loop-desc">Description</label>
              <input
                id="loop-desc"
                className="input"
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="loop-model">Model</label>
              <select
                id="loop-model"
                className="select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {modelOptions.map(({ g, m }) => (
                  <option key={`${g}/${m.id}`} value={`${g}/${m.id}`}>
                    {g}/{m.id}
                  </option>
                ))}
              </select>
            </div>
            <CwdPicker value={cwd} onSelect={setCwd} placeholder="workspace root (host)" />
          </Card>

          {/* Prompt */}
          <Card title="Prompt">
            <div className="field">
              <label htmlFor="loop-prompt">
                Prompt <span style={{ color: 'var(--error)' }}>*</span>
              </label>
              <div className="help">
                Runs every round; <code>{'{round}'}</code> is replaced with the round number.
              </div>
              <textarea
                id="loop-prompt"
                className="textarea"
                rows={5}
                value={form.prompt ?? ''}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
              <div className="code-preview" style={{ marginTop: 'var(--s-2)' }}>
                <div className="muted" style={{ marginBottom: 4 }}>
                  Preview rounds 1-3:
                </div>
                {previewRounds.map((text, i) => (
                  <div key={i} style={{ marginTop: 2 }}>
                    Round {i + 1}:{' '}
                    {text.length > 90 ? `${text.slice(0, 90)}…` : text || '(empty)'}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Schedule & limits */}
          <Card title="Schedule & limits">
            <div className="field">
              <label htmlFor="loop-transition">Transition between rounds</label>
              <select
                id="loop-transition"
                className="select"
                value={form.transition?.kind ?? 'none'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    transition: { kind: e.target.value as LoopTransition['kind'] },
                  })
                }
              >
                <option value="none">None (straight to next round)</option>
                <option value="compact">Compact</option>
                <option value="skill">Invoke a skill</option>
                <option value="gate">Gate (wait for me to decide)</option>
              </select>
            </div>
            {form.transition?.kind === 'skill' && (
              <div className="field">
                <label htmlFor="loop-skill">Skill</label>
                <select
                  id="loop-skill"
                  className="select"
                  value={form.transition?.skillName ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, transition: { kind: 'skill', skillName: e.target.value } })
                  }
                >
                  <option value="">Select…</option>
                  {skillOptions.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid cols-2">
              <div className="field">
                <label htmlFor="loop-max-rounds">Max rounds (blank = indefinite)</label>
                <input
                  id="loop-max-rounds"
                  className="input"
                  type="number"
                  min={1}
                  value={form.maxRounds ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxRounds: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="loop-max-time">Max time ms (blank = indefinite)</label>
                <input
                  id="loop-max-time"
                  className="input"
                  type="number"
                  min={1}
                  step={1000}
                  value={form.maxTimeMs ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxTimeMs: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </div>
            </div>
            {/* Actions pinned at the bottom of the form */}
            <div className="row" style={{ marginTop: 'var(--s-4)' }}>
              <button className="btn primary" onClick={save}>
                {editingId ? 'Update loop' : 'Save loop'}
              </button>
              <button className="btn ghost" onClick={reset}>
                Reset
              </button>
            </div>
            <div className="code-preview" style={{ marginTop: 'var(--s-3)' }}>
              Loop model: [round N] → [{form.transition?.kind ?? 'none'}] → [round N+1] …
            </div>
          </Card>

          <div>
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}
            >
              {loops.map((loop) => {
                const p = progress[loop.id];
                const gated = p?.status === 'gated';
                return (
                  <Card
                    key={loop.id}
                    title={<span style={{ fontSize: 14 }}>{loop.name}</span>}
                    actions={
                      <StatusPill tone={LOOP_TONE[p?.status ?? 'idle'] ?? 'idle'} dot={p?.status === 'running'}>
                        {p?.status ?? 'idle'}
                      </StatusPill>
                    }
                  >
                    {loop.description && (
                      <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                        {loop.description}
                      </div>
                    )}
                    <div
                      className="row"
                      style={{ marginBottom: 8, flexWrap: 'wrap', gap: 'var(--s-2)' }}
                    >
                      <StatusPill tone="idle">transition: {loop.transition.kind}</StatusPill>
                      {loop.transition.kind === 'skill' && (
                        <StatusPill tone="info">{loop.transition.skillName}</StatusPill>
                      )}
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {loop.maxRounds ? `max ${loop.maxRounds} rounds` : 'unlimited rounds'}
                        {loop.maxTimeMs ? ` · max ${Math.round(loop.maxTimeMs / 1000)}s` : ''}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: 'var(--text-faint)' }}
                        title={`${loop.model.provider}/${loop.model.modelId}`}
                      >
                        {loop.model.provider}/{loop.model.modelId}
                      </span>
                    </div>

                    {p && (
                      <>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                          current round: <span className="mono">{p.currentRound}</span>
                          {p.startedAt && <span> · started {fmtTime(p.startedAt)}</span>}
                          {p.stopReason && <span> · {p.stopReason}</span>}
                        </div>
                        <table className="table" style={{ marginBottom: 10 }}>
                          <thead>
                            <tr>
                              <th>Round</th>
                              <th>Started</th>
                              <th>Finished</th>
                              <th>Summary</th>
                              <th>Errored</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.rounds.length === 0 && (
                              <tr>
                                <td colSpan={5} className="muted">
                                  No rounds yet
                                </td>
                              </tr>
                            )}
                            {p.rounds.map((r) => (
                              <tr key={r.round}>
                                <td className="num">r{r.round}</td>
                                <td>{fmtTime(r.startedAt)}</td>
                                <td>{fmtTime(r.finishedAt)}</td>
                                <td className="muted">
                                  {r.summary
                                    ? r.summary.length > 60
                                      ? `${r.summary.slice(0, 60)}…`
                                      : r.summary
                                    : '—'}
                                </td>
                                <td>
                                  {r.errored ? (
                                    <StatusPill tone="error">errored</StatusPill>
                                  ) : (
                                    <StatusPill tone="ok">ok</StatusPill>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}

                    {gated && (
                      <div
                        className="card"
                        style={{
                          borderColor: 'var(--warn)',
                          background: 'var(--warn-soft)',
                          padding: '10px 12px',
                          marginBottom: 10,
                        }}
                      >
                        <div className="row" style={{ alignItems: 'center' }}>
                          <StatusPill tone="warn" dot>
                            gated after round {p?.currentRound}
                          </StatusPill>
                          <div className="spacer" />
                          <button className="btn primary" onClick={() => gate(loop.id, 'continue')}>
                            Continue
                          </button>
                          <button className="btn danger" onClick={() => gate(loop.id, 'stop')}>
                            Stop
                          </button>
                        </div>
                      </div>
                    )}

                    {!gated &&
                      (p?.status === 'running' ? (
                        <button className="btn danger" onClick={() => stop(loop.id)}>
                          <Icon name="stop" size={13} /> Stop
                        </button>
                      ) : (
                        <button className="btn primary" onClick={() => run(loop.id)}>
                          <Icon name="play" size={13} /> Start
                        </button>
                      ))}
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn"
                        disabled={!p?.sessionId}
                        title={
                          p?.sessionId
                            ? 'Inspect the loop session transcript'
                            : 'Start the loop first'
                        }
                        onClick={() => openInspect(loop.id, p?.sessionId)}
                      >
                        Inspect live chat
                      </button>
                    </div>
                  </Card>
                );
              })}
              {loops.length === 0 && (
                <EmptyState
                  icon="loops"
                  title="No loops defined yet"
                  message="Create one with the form above, or start from an existing skill."
                  action={
                    <button className="btn" onClick={() => onNavigate?.('skills')}>
                      Browse skills
                    </button>
                  }
                />
              )}
            </div>

            {eventLog.length > 0 && (
              <Card title="Live event stream">
                <div className="console" style={{ height: 180 }} ref={eventLogRef}>
                  {eventLog.map((line, i) => (
                    <div key={i} className="meta">
                      {line}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {inspect && (
        <div
          className="fill"
          role="dialog"
          aria-modal="true"
          aria-label={`Live chat for loop ${inspect.loopId}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeInspect();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'var(--bg)',
            padding: 'var(--s-5)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div className="chat" style={{ minHeight: 0 }}>
            <ChatConsole
              items={inspectItems}
              stats={inspectStats}
              header={
                <>
                  <span style={{ fontWeight: 600 }}>
                    Loop: <span className="mono">{inspect.loopId}</span>
                  </span>
                  {inspect.sessionId && (
                    <>
                      <StatusPill tone="info">session</StatusPill>
                      <CopyButton text={inspect.sessionId} title="Copy session id" />
                    </>
                  )}
                  <StatusPill tone="running" dot>
                    streaming live
                  </StatusPill>
                  <div className="spacer" />
                  <button
                    ref={closeInspectRef}
                    className="btn"
                    onClick={closeInspect}
                    aria-label="Close loop inspector"
                  >
                    <Icon name="close" size={14} /> Close
                  </button>
                </>
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
