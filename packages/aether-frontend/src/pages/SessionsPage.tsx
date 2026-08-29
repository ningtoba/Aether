import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  listSessions,
  createSession,
  disposeSession,
  promptSession,
  compactSession,
  listModels,
  listDiskSessions,
  readDiskSession,
  type SessionSummary,
  type ModelGroup,
  type DiskSessionInfo,
} from '../lib/api';
import { RealtimeClient, type RealtimeFrame } from '../lib/realtime';

interface Msg {
  who: 'user' | 'assistant' | 'thinking' | 'tool' | 'meta';
  text: string;
}

const COLORS: Record<string, string> = {
  running: '#4f8cff',
  idle: '#8b949e',
  error: '#f85149',
  closed: '#6e7681',
};

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [diskSessions, setDiskSessions] = useState<DiskSessionInfo[]>([]);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [model, setModel] = useState('local-server/deepseek-ai/DeepSeek-V4-Flash-0731');
  const [current, setCurrent] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [rt, setRt] = useState<RealtimeClient | null>(null);
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [viewingDisk, setViewingDisk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const accRef = useRef<Record<string, string>>({});

  const refresh = useCallback(() => {
    listSessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(e.message));
    listDiskSessions()
      .then((r) => setDiskSessions(r.sessions))
      .catch(() => {
        /* disk-session browsing is optional (non-Bun mode) */
      });
  }, []);

  useEffect(() => {
    refresh();
    listModels()
      .then((r) => setGroups(r.groups))
      .catch(() => {});
  }, [refresh]);

  // Accept a /health-provided realtime port (poll once to discover it).
  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then((h) => {
        if (!h?.realtime?.port) return;
        setRt((prev) => prev ?? new RealtimeClient(h.realtime.port));
      })
      .catch(() => {});
  }, []);

  // Patch a client-side connection-state echo into the realtime client.
  useEffect(() => {
    if (!rt) return;
    const iv = setInterval(() => {
      setWsState(rt.connected ? 'open' : 'connecting');
    }, 500);
    return () => clearInterval(iv);
  }, [rt]);

  useEffect(() => {
    if (!rt) return;
    const unsub = rt.subscribe((frame: RealtimeFrame) => {
      if (frame.payload?.namespace !== 'session') return;
      const sid = frame.payload.sessionId;
      if (!current || current !== sid) return;
      const ev = frame.payload.event;
      const kind = ev?.kind;
      if (kind === 'message_update') {
        const role = ev.role === 'thinking' ? 'thinking' : 'assistant';
        const acc = accRef.current;
        const key = `${sid}:${role}`;
        const prev = acc[key] ?? '';
        acc[key] = prev + String(ev.delta ?? '');
        // Flush the accumulated text into the live console message.
        setMsgs((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last && last.who === role) {
            next[next.length - 1] = { ...last, text: acc[key] };
            return next;
          }
          return [...next, { who: role, text: acc[key] }];
        });
      } else if (kind === 'message_end') {
        // Finalize: replace the streamed accumulator with the authoritative
        // full text (the model may emit a single end with the whole reply).
        const text = String(ev.text ?? '');
        const role = 'assistant';
        const acc = accRef.current;
        acc[`${sid}:assistant`] = '';
        setMsgs((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last && last.who === role) {
            next[next.length - 1] = { ...last, text: text || last.text };
            return next;
          }
          return [...next, { who: role, text: text || '(empty reply)' }];
        });
      } else if (kind === 'tool_call') {
        setMsgs((m) => [...m, { who: 'tool', text: `🔧 call ${String(ev.name ?? '')}` }]);
      } else if (kind === 'tool_result') {
        setMsgs((m) => [...m, { who: 'tool', text: `↩ result ${String(ev.name ?? '')}` }]);
      } else if (kind === 'turn_start') {
        setMsgs((m) => [...m, { who: 'meta', text: '── turn start ──' }]);
      } else if (kind === 'agent_end') {
        setMsgs((m) => [...m, { who: 'meta', text: '── agent end ──' }]);
      } else if (kind === 'session_error') {
        setMsgs((m) => [...m, { who: 'meta', text: `⚠ error: ${String(ev.message ?? '')}` }]);
      }
    });
    return unsub;
  }, [rt, current]);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [msgs]);

  const openSession = async () => {
    const slash = model.indexOf('/');
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    try {
      const { session } = await createSession({ provider, modelId });
      setCurrent(session.id);
      setViewingDisk(null);
      setMsgs([]);
      accRef.current = {};
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openHistory = async (s: SessionSummary) => {
    setCurrent(s.id);
    setViewingDisk(null);
    setMsgs([]);
    accRef.current = {};
  };

  const openDiskSession = async (info: DiskSessionInfo) => {
    try {
      const { transcript } = await readDiskSession(info.path);
      setMsgs(
        transcript.messages.map((m) => ({
          who: (m.role === 'user' ? 'user' : 'assistant') as Msg['who'],
          text: m.text,
        })),
      );
      setViewingDisk(info.path);
      setCurrent(null);
      accRef.current = {};
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async () => {
    if (!input.trim() || !current) return;
    setMsgs((m) => [...m, { who: 'user', text: input }]);
    const text = input;
    setInput('');
    try {
      await promptSession(current, text);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doCompact = async () => {
    if (!current) return;
    setMsgs((m) => [...m, { who: 'meta', text: '── compacting context ──' }]);
    await compactSession(current).catch((e) => setError(e.message));
  };

  const close = async () => {
    if (!current) return;
    await disposeSession(current).catch(() => {});
    accRef.current = {};
    setCurrent(null);
    setViewingDisk(null);
    setMsgs([]);
    refresh();
  };

  const wsColor = wsState === 'open' ? 'var(--green)' : 'var(--yellow)';

  return (
    <>
      <h2>Sessions</h2>
      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--red)' }}>
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr' }}>
        <div className="card">
          <h3>New session</h3>
          <div className="field">
            <label>Model</label>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
              {groups
                .flatMap((g) => g.models.map((m) => ({ g: g.provider, m })))
                .map(({ g, m }) => (
                  <option key={`${g}/${m.id}`} value={`${g}/${m.id}`}>
                    {g}/{m.id}
                  </option>
                ))}
            </select>
          </div>
          <button className="btn primary" onClick={openSession}>
            Open session
          </button>

          <h3 style={{ marginTop: 18 }}>History</h3>
          <div className="stack">
            {sessions.map((s) => (
              <div key={s.id} className="row">
                <button
                  className={`btn ${current === s.id ? 'primary' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => openHistory(s)}
                >
                  {s.id}
                </button>
                <span className="tag" style={{ borderColor: COLORS[s.status] }}>
                  {s.status}
                </span>
              </div>
            ))}
            {sessions.length === 0 && <span className="muted">No live sessions yet</span>}
          </div>

          <h3 style={{ marginTop: 18 }}>Persisted (omp on disk)</h3>
          <div className="stack">
            {diskSessions.slice(0, 30).map((s) => (
              <button
                key={s.path}
                className={`btn ${viewingDisk === s.path ? 'primary' : ''}`}
                style={{ textAlign: 'left' }}
                onClick={() => openDiskSession(s)}
                title={s.path}
              >
                <span style={{ display: 'block' }}>{s.displayName || s.name || s.id}</span>
                <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                  {s.cwd}
                </span>
              </button>
            ))}
            {diskSessions.length === 0 && <span className="muted">No persisted sessions</span>}
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>{current ?? viewingDisk ?? 'No active session'}</h3>
            <span
              className="tag"
              style={{
                borderColor: wsColor,
                color: wsState === 'open' ? 'var(--green)' : 'var(--yellow)',
              }}
            >
              realtime {wsState}
            </span>
            <div className="spacer" />
            {current && (
              <>
                <button className="btn" onClick={doCompact}>
                  Compact
                </button>
                <button className="btn danger" onClick={close}>
                  Dispose
                </button>
              </>
            )}
            {current && (
              <button className="btn" onClick={close}>
                Close
              </button>
            )}
          </div>
          <div className="console" ref={consoleRef}>
            {msgs.length === 0 && <div className="meta">(open a session and prompt it)</div>}
            {msgs.map((m, i) => (
              <div key={i} className="eq">
                <span className="who">{m.who}</span>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                >
                  {m.text}
                </pre>
              </div>
            ))}
          </div>
          {current && (
            <div className="row" style={{ marginTop: 10 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Prompt the agent…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
              />
              <button className="btn primary" onClick={send}>
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
