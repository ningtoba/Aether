import React, { useCallback, useEffect, useState } from 'react';
import {
  listLoops,
  saveLoop,
  deleteLoop,
  startLoop,
  stopLoop,
  advanceLoop,
  listModels,
  listSkills,
  type LoopDefinition,
  type LoopProgress,
  type ModelGroup,
  type SkillRecord,
} from '../lib/api';
import { RealtimeClient, type RealtimeFrame } from '../lib/realtime';
import type { PageId } from '../App';

const EMPTY: Partial<LoopDefinition> = {
  name: 'My loop',
  prompt: 'Improve this project. Round {round}:',
  transition: { kind: 'none' },
};

export function LoopsPage({ onNavigate }: { onNavigate?: (p: PageId) => void }) {
  const [loops, setLoops] = useState<LoopDefinition[]>([]);
  const [progress, setProgress] = useState<Record<string, LoopProgress>>({});
  const [form, setForm] = useState<Partial<LoopDefinition>>({ ...EMPTY });
  const [models, setModels] = useState<ModelGroup[]>([]);
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [eventLog, setEventLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('local-server/deepseek-ai/DeepSeek-V4-Flash-0731');

  const refresh = useCallback(() => {
    listLoops()
      .then((r) => setLoops(r.loops))
      .catch((e) => setError(e.message));
    listModels()
      .then((r) => setModels(r.groups))
      .catch(() => {});
    listSkills()
      .then((r) => setSkills(r.skills))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    let release: (() => void) | undefined;
    let disposed = false;
    fetch('/health')
      .then((r) => r.json())
      .then((h) => {
        if (disposed || !h?.realtime?.port) return;
        const client = new RealtimeClient(h.realtime.port);
        release = client.subscribe((frame: RealtimeFrame) => {
          if (frame.payload?.namespace !== 'loop') return;
          const ev = frame.payload.event as Record<string, unknown> & {
            loopId?: string;
            kind?: string;
            round?: number;
          };
          const kind = ev?.kind ?? '';
          const line = `[${new Date().toISOString().slice(11, 19)}] ${kind}${ev.loopId ? ' ' + ev.loopId : ''}${ev.round ? ' r' + ev.round : ''}`;
          setEventLog((l) => [...l.slice(-80), line]);
          if (ev.loopId && /round_end|gated|stop|completed|transition/.test(kind)) {
            fetch(`/api/loops/${ev.loopId}`)
              .then((r) => r.json())
              .then((d) => {
                if (d.progress) setProgress((p) => ({ ...p, [d.progress.id]: d.progress }));
              })
              .catch(() => {});
          }
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      release?.();
    };
  }, [refresh]);

  const modelOptions = models.flatMap((g) => g.models.map((m) => ({ g: g.provider, m })));

  const save = async () => {
    const slash = selectedModel.indexOf('/');
    const provider = selectedModel.slice(0, slash);
    const modelId = selectedModel.slice(slash + 1);
    try {
      const { loop } = await saveLoop({ ...form, model: { provider, modelId } });
      setLoops((l) => [loop, ...l.filter((x) => x.id !== loop.id)]);
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

  return (
    <>
      <h2>Loops</h2>
      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}>
          <span className="muted">{error}</span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '340px 1fr' }}>
        {/* Editor */}
        <div className="card">
          <h3>Define loop</h3>
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Prompt (runs every round; `{'{round}'}` is replaced)</label>
            <textarea
              className="textarea"
              value={form.prompt ?? ''}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Transition between rounds</label>
            <select
              className="select"
              value={form.transition?.kind ?? 'none'}
              onChange={(e) =>
                setForm({
                  ...form,
                  transition: { kind: e.target.value as LoopDefinition['transition']['kind'] },
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
                {skills.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Max rounds (blank = indefinite)</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.maxRounds ?? ''}
              onChange={(e) =>
                setForm({ ...form, maxRounds: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </div>
          <div className="field">
            <label>Model</label>
            <select className="select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {modelOptions.map(({ g, m }) => (
                <option key={`${g}/${m.id}`} value={`${g}/${m.id}`}>
                  {g}/{m.id}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button className="btn primary" onClick={save}>
              Save loop
            </button>
            <button className="btn" onClick={() => setForm({ ...EMPTY })}>
              Reset
            </button>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Loop model: <span className="mono">[round N] → [{form.transition?.kind ?? 'none'}] → [round N+1] …</span>
          </p>
        </div>

        {/* Runner list */}
        <div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {loops.map((loop) => {
              const p = progress[loop.id];
              return (
                <div className="card" key={loop.id}>
                  <div className="row">
                    <h3 style={{ margin: 0 }}>{loop.name}</h3>
                    <div className="spacer" />
                    {p && <span className={`tag ${p.status}`}>{p.status}</span>}
                  </div>
                  <div className="muted mono" style={{ fontSize: 11, margin: '4px 0 8px' }}>
                    {loop.prompt.slice(0, 60)}
                  </div>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span className="tag">transition: {loop.transition.kind}</span>
                    {loop.transition.kind === 'skill' && (
                      <span className="tag">{loop.transition.skillName}</span>
                    )}
                    {loop.maxRounds && <span className="tag">max {loop.maxRounds}</span>}
                    <span className="tag mono">{loop.model.provider}/{loop.model.modelId}</span>
                  </div>

                  {p && (
                    <div className="stack" style={{ marginBottom: 10 }}>
                      <div className="row">
                        <span className="muted">Rounds:</span>
                        {p.rounds.length === 0 && <span className="muted">0</span>}
                        {p.rounds.map((r) => (
                          <div key={r.round} className="stack" style={{ gap: 2 }}>
                            <span className={`tag ${r.errored ? 'error' : 'completed'}`}>r{r.round}</span>
                            {r.summary && (
                              <span className="muted" style={{ fontSize: 11 }}>
                                {r.summary.slice(0, 60)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                      {p.stopReason && <div className="muted">stopped: {p.stopReason}</div>}
                    </div>
                  )}

                  {p?.status === 'gated' ? (
                    <div className="row" style={{ marginTop: 8 }}>
                      <span className="tag gated">⏸ gated after round {p.currentRound}</span>
                      <div className="spacer" />
                      <button className="btn primary" onClick={() => gate(loop.id, 'continue')}>
                        Continue
                      </button>
                      <button className="btn danger" onClick={() => gate(loop.id, 'stop')}>
                        Stop
                      </button>
                    </div>
                  ) : p?.status === 'running' ? (
                    <button className="btn danger" onClick={() => stop(loop.id)}>
                      Stop
                    </button>
                  ) : (
                    <div className="row">
                      <button className="btn primary" onClick={() => run(loop.id)}>
                        Run
                      </button>
                      <button
                        className="btn"
                        onClick={async () => {
                          await deleteLoop(loop.id).catch((e) => setError(e.message));
                          refresh();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
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
              <div className="console" style={{ height: 180 }}>
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
    </>
  );
}
