import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  getSessionTranscript,
  type LoopDefinition,
  type LoopProgress,
  type LoopTransition,
  type ModelGroup,
  type SkillRecord,
} from '../lib/api';
import { RealtimeClient, type RealtimeFrame } from '../lib/realtime';
import { ChatConsole } from '../components/ChatConsole';
import { CwdPicker } from '../components/CwdPicker';
import { reduceChatFrame, appendMeta, fromTranscriptEntries, type ChatItem } from '../lib/chat';
import type { PageId } from '../App';

const EMPTY: Partial<LoopDefinition> = {
  name: 'My loop',
  description: '',
  prompt: 'Improve this project. Round {round}:',
  transition: { kind: 'none' },
};

const DEFAULT_MODEL = 'local-server/deepseek-ai/DeepSeek-V4-Flash-0731';

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

  const openInspect = (loopId: string, sessionId?: string) => {
    setInspect({ loopId, sessionId });
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
      <h2>Loops</h2>
      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}>
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr' }}>
        {/* Saved-loop list */}
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Saved loops</h3>
            <div className="spacer" />
            <button className="btn" onClick={reset}>
              New
            </button>
          </div>
          <div className="stack">
            {loops.map((loop) => (
              <div key={loop.id} className="row">
                <button
                  className={`btn ${editingId === loop.id ? 'primary' : ''}`}
                  style={{ flex: 1, textAlign: 'left' }}
                  onClick={() => loadIntoForm(loop)}
                  title={loop.prompt}
                >
                  <span style={{ display: 'block' }}>{loop.name}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                    {loop.prompt.length > 42 ? `${loop.prompt.slice(0, 42)}…` : loop.prompt}
                  </span>
                </button>
                <button className="btn danger" onClick={() => del(loop.id)}>
                  Delete
                </button>
              </div>
            ))}
            {loops.length === 0 && <span className="muted">No saved loops yet</span>}
          </div>
        </div>

        {/* Editor + runners */}
        <div className="stack">
          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{editingId ? 'Edit loop' : 'Define loop'}</h3>
              {editingId && <span className="tag">editing {editingId}</span>}
            </div>
            <div className="field">
              <label>Name</label>
              <input
                className="input"
                value={form.name ?? ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Description</label>
              <input
                className="input"
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="field">
              <label>
                Prompt (runs every round; `{'{round}'}` is replaced with the round number)
              </label>
              <textarea
                className="textarea"
                rows={5}
                value={form.prompt ?? ''}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
              <div className="muted" style={{ fontSize: 11 }}>
                Preview rounds 1-3:
                {previewRounds.map((text, i) => (
                  <div key={i} className="mono" style={{ marginTop: 2 }}>
                    Round {i + 1}: {text.length > 90 ? `${text.slice(0, 90)}…` : text || '(empty)'}
                  </div>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Model</label>
              <select
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
            <div className="field">
              <label>Transition between rounds</label>
              <select
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
                <label>Skill</label>
                <select
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
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label>Max rounds (blank = indefinite)</label>
                <input
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
                <label>Max time ms (blank = indefinite)</label>
                <input
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
            <div className="row">
              <button className="btn primary" onClick={save}>
                {editingId ? 'Update loop' : 'Save loop'}
              </button>
              <button className="btn" onClick={reset}>
                Reset
              </button>
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Loop model:{' '}
              <span className="mono">
                [round N] → [{form.transition?.kind ?? 'none'}] → [round N+1] …
              </span>
            </p>
          </div>

          <div>
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}
            >
              {loops.map((loop) => {
                const p = progress[loop.id];
                const gated = p?.status === 'gated';
                return (
                  <div className="card" key={loop.id}>
                    <div className="row">
                      <h3 style={{ margin: 0 }}>{loop.name}</h3>
                      <div className="spacer" />
                      {p ? (
                        <span className={`tag ${p.status}`}>{p.status}</span>
                      ) : (
                        <span className="tag">idle</span>
                      )}
                    </div>
                    {loop.description && (
                      <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                        {loop.description}
                      </div>
                    )}
                    <div className="row" style={{ marginBottom: 8 }}>
                      <span className="tag">transition: {loop.transition.kind}</span>
                      {loop.transition.kind === 'skill' && (
                        <span className="tag">{loop.transition.skillName}</span>
                      )}
                      <span className="tag">
                        {loop.maxRounds ? `max ${loop.maxRounds}` : 'unlimited'}
                      </span>
                      {loop.maxTimeMs ? (
                        <span className="tag">max {Math.round(loop.maxTimeMs / 1000)}s</span>
                      ) : null}
                      <span className="tag mono">
                        {loop.model.provider}/{loop.model.modelId}
                      </span>
                    </div>

                    {p && (
                      <>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                          current round: <span className="tag">{p.currentRound}</span>
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
                                <td>r{r.round}</td>
                                <td>{fmtTime(r.startedAt)}</td>
                                <td>{fmtTime(r.finishedAt)}</td>
                                <td className="muted">
                                  {r.summary
                                    ? r.summary.length > 60
                                      ? `${r.summary.slice(0, 60)}…`
                                      : r.summary
                                    : '—'}
                                </td>
                                <td>{r.errored ? 'yes' : 'ok'}</td>
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
                          borderColor: 'var(--yellow)',
                          background: 'rgba(210, 153, 34, 0.08)',
                          padding: '10px 12px',
                          marginBottom: 10,
                        }}
                      >
                        <div className="row">
                          <span className="tag gated">gated after round {p?.currentRound}</span>
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
                          Stop
                        </button>
                      ) : (
                        <button className="btn primary" onClick={() => run(loop.id)}>
                          Start
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
                  </div>
                );
              })}
              {loops.length === 0 && (
                <div className="card">
                  <span className="muted">No loops defined yet — create one on the left.</span>
                  <div>
                    <button className="btn" onClick={() => onNavigate?.('skills')}>
                      Browse skills
                    </button>
                  </div>
                </div>
              )}
            </div>

            {eventLog.length > 0 && (
              <div className="card" style={{ marginTop: 16 }}>
                <h3>Live event stream</h3>
                <div className="console" style={{ height: 180 }} ref={eventLogRef}>
                  {eventLog.map((line, i) => (
                    <div key={i} className="meta">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {inspect && (
        <div
          className="fill"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'var(--bg)',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div className="chat" style={{ minHeight: 0 }}>
            <ChatConsole
              items={inspectItems}
              header={
                <>
                  <span style={{ fontWeight: 600 }}>Loop: {inspect.loopId}</span>
                  {inspect.sessionId && (
                    <span className="tag" style={{ borderColor: 'var(--green)' }}>
                      session {inspect.sessionId}
                    </span>
                  )}
                  <span className="muted" style={{ fontSize: 11 }}>
                    streaming live
                  </span>
                  <div className="spacer" />
                  <button className="btn" onClick={closeInspect}>
                    Close
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
