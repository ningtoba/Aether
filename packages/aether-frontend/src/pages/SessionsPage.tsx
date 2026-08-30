import React, { useCallback, useEffect, useState } from 'react';
import {
  listSessions,
  createSession,
  disposeSession,
  promptSession,
  compactSession,
  listModels,
  listDiskSessions,
  readDiskSession,
  getSession,
  type SessionSummary,
  type ModelGroup,
  type DiskSessionInfo,
} from '../lib/api';
import { RealtimeClient, type RealtimeFrame } from '../lib/realtime';
import { ChatConsole } from '../components/ChatConsole';
import type { ChatStats } from '../components/ChatConsole';
import { CwdPicker } from '../components/CwdPicker';
import { reduceChatFrame, appendUser, fromMessages, type ChatItem } from '../lib/chat';

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
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [rt, setRt] = useState<RealtimeClient | null>(null);
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [viewingDisk, setViewingDisk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStats, setActiveStats] = useState<ChatStats | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');

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
  // Load the active session's stats + model for the status line.
  const loadActive = useCallback((id: string) => {
    getSession(id)
      .then((r) => {
        const s = r.session;
        setActiveStats(s.stats ?? null);
        setActiveModel(`${s.model.provider}/${s.model.modelId}`);
      })
      .catch(() => {});
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

  useEffect(() => {
    if (!rt) return;
    const iv = setInterval(() => {
      setWsState(rt.connected ? 'open' : 'connecting');
    }, 500);
    return () => clearInterval(iv);
  }, [rt]);

  // Fold live frames into the transcript, only while a session is open.
  useEffect(() => {
    if (!rt || !current) return;
    const unsub = rt.subscribe((frame: RealtimeFrame) => {
      const sid = frame.payload?.sessionId;
      if (sid && sid !== current) return;
      const ev = frame.payload?.event as Record<string, unknown> & { kind?: string };
      if (ev?.kind === 'agent_end') loadActive(current);
      setItems((it) => reduceChatFrame(it, frame));
    });
    return unsub;
  }, [rt, current, loadActive]);

  const openSession = async () => {
    const slash = model.indexOf('/');
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    try {
      const { session } = await createSession({ provider, modelId }, cwd);
      setCurrent(session.id);
      loadActive(session.id);
      setViewingDisk(null);
      setItems([]);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openHistory = async (s: SessionSummary) => {
    setCurrent(s.id);
    setViewingDisk(null);
    setItems([]);
    loadActive(s.id);
  };

  const openDiskSession = async (info: DiskSessionInfo) => {
    try {
      const { transcript } = await readDiskSession(info.path);
      setItems(fromMessages(transcript.messages));
      setViewingDisk(info.path);
      setCurrent(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || !current) return;
    setItems((it) => appendUser(it, text));
    try {
      await promptSession(current, text);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doCompact = async () => {
    if (!current) return;
    await compactSession(current).catch((e) => setError(e.message));
  };

  const close = async () => {
    if (!current) return;
    await disposeSession(current).catch(() => {});
    setCurrent(null);
    setViewingDisk(null);
    setItems([]);
    refresh();
  };

  const wsColor = wsState === 'open' ? 'var(--green)' : 'var(--yellow)';

  return (
    <div className="fill" style={{ display: 'flex', flexDirection: 'row', gap: 14 }}>
      <div style={{ flexBasis: 260, flexShrink: 0, width: 260 }} className="panel">
        <div className="chat-header">
          <span style={{ fontWeight: 600 }}>Sessions</span>
          <div className="spacer" />
          <span className="tag" style={{ borderColor: wsColor }}>
            {wsState}
          </span>
        </div>
        <div className="panel-scroll" style={{ padding: '10px 12px' }}>
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
          <button className="btn primary" style={{ width: '100%' }} onClick={openSession}>
            + New session
          </button>
          <div style={{ marginTop: 10 }}>
            <CwdPicker value={cwd} onSelect={setCwd} placeholder="workspace root (host)" />
          </div>

          <h3 style={{ margin: '16px 0 8px', fontSize: 12 }}>Live</h3>
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

          <h3 style={{ margin: '16px 0 8px', fontSize: 12 }}>Persisted (omp on disk)</h3>
          <div className="stack">
            {diskSessions.slice(0, 60).map((s) => (
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
      </div>

      <div style={{ flex: 1, minWidth: 0 }} className="panel">
        <ChatConsole
          items={items}
          onSend={send}
          stats={activeStats}
          model={activeModel}
          header={
            <>
              <span style={{ fontWeight: 600 }}>
                {current ?? viewingDisk ?? 'No active session'}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                model · {viewingDisk ? 'persisted transcript' : activeModel || model}
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
            </>
          }
        />
      </div>

      {error && (
        <div
          className="card"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 10,
            borderColor: 'var(--red)',
          }}
        >
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
