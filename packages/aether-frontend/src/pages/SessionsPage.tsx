import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  getSessionTranscript,
  type SessionSummary,
  type ModelGroup,
  type DiskSessionInfo,
} from '../lib/api';
import { getRealtimeClient, type RealtimeFrame } from '../lib/realtime';
import { ChatConsole } from '../components/ChatConsole';
import type { ChatStats } from '../components/ChatConsole';
import { CwdPicker } from '../components/CwdPicker';
import {
  reduceChatFrame,
  appendUser,
  appendMeta,
  fromMessages,
  fromTranscriptEntries,
  type ChatItem,
} from '../lib/chat';
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  Icon,
  StatusPill,
  fmtRelative,
  type StatusTone,
} from '../components/ui';

// Machine default only as the last-resort fallback: once the model list
// loads, a selection missing from it is auto-corrected to the first real one.
const DEFAULT_MODEL = 'local-server/deepseek-ai/DeepSeek-V4-Flash-0731';

const STATUS_TONE: Record<string, StatusTone> = {
  running: 'running',
  idle: 'idle',
  error: 'error',
  closed: 'idle',
};

export function SessionsPage({ initialSessionId }: { initialSessionId?: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [diskSessions, setDiskSessions] = useState<DiskSessionInfo[]>([]);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [current, setCurrent] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [viewingDisk, setViewingDisk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Informational channel (e.g. a resume `warning` on the 201): same corner
  // card as the error toast but info tone — never role="alert", never red.
  const [notice, setNotice] = useState<string | null>(null);
  const [activeStats, setActiveStats] = useState<ChatStats | null>(null);
  const [activeModel, setActiveModel] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  // Items-view generation counter: every async writer to `items` captures it
  // at request start and discards its response once a newer open/close has
  // bumped it (fast clicking between sessions/disk transcripts used to let a
  // stale response overwrite the fresh view).
  const itemsReqRef = useRef(0);

  const refresh = useCallback(() => {
    listSessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(e.message));
    // Scope persisted-session browsing to the picked working directory so the
    // list matches the directory new sessions will run in.
    listDiskSessions(cwd)
      .then((r) => setDiskSessions(r.sessions))
      .catch(() => {
        /* disk-session browsing is optional (non-Bun mode) */
      });
  }, [cwd]);
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

  /** Fetch the live session's persisted transcript so opening a session (and
   *  reconnect recovery) renders real history, not just the stats line.
   *  Responses from a superseded open are discarded. */
  const loadTranscript = useCallback((id: string) => {
    const reqId = ++itemsReqRef.current;
    getSessionTranscript(id)
      .then((d) => {
        if (itemsReqRef.current !== reqId) return;
        setItems(fromTranscriptEntries(d.transcript.entries));
      })
      .catch(() => {
        /* transcript endpoint unavailable — live frames still fill the view */
      });
  }, []);

  useEffect(() => {
    refresh();
    listModels()
      .then((r) => setGroups(r.groups))
      .catch(() => {});
  }, [refresh]);

  // Once the catalog is loaded, never leave a non-existent model selected —
  // pick the first available one (payload shapes unchanged).
  useEffect(() => {
    const opts = groups.flatMap((g) => g.models.map((m) => `${g.provider}/${m.id}`));
    const first = opts[0];
    if (first && !opts.includes(model)) setModel(first);
  }, [groups, model]);

  // The realtime singleton discovers its own port (lib/realtime.ts); this
  // only mirrors the shared socket's state into the header pill.
  useEffect(() => {
    const rt = getRealtimeClient();
    const iv = setInterval(() => {
      setWsState(rt.connected ? 'open' : 'connecting');
    }, 500);
    return () => clearInterval(iv);
  }, []);

  // Fold live frames into the transcript, only while a session is open.
  useEffect(() => {
    if (!current) return;
    const unsub = getRealtimeClient().subscribe((frame: RealtimeFrame) => {
      const sid = frame.payload?.sessionId;
      if (sid && sid !== current) return;
      const ev = frame.payload?.event as Record<string, unknown> & { kind?: string };
      if (ev?.kind === 'agent_end') loadActive(current);
      setItems((it) => reduceChatFrame(it, frame));
    });
    return unsub;
  }, [current, loadActive]);

  // Frames emitted while the socket was down are gone forever: on every
  // (re)connect after the first, re-pull the open session's stats AND
  // transcript so streaming blocks can never stick on a stale cursor.
  useEffect(
    () =>
      getRealtimeClient().onReconnect(() => {
        if (!current) return;
        loadActive(current);
        loadTranscript(current);
      }),
    [current, loadActive, loadTranscript],
  );

  const openSession = async () => {
    if (creating) return; // busy guard — no double-spawn on double click
    const slash = model.indexOf('/');
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    setCreating(true);
    try {
      const { session } = await createSession({ provider, modelId }, cwd);
      setCurrent(session.id);
      loadActive(session.id);
      setViewingDisk(null);
      itemsReqRef.current++; // discard any in-flight transcript of the old view
      setItems([]);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // Resume a persisted omp session: same open path as a plain create, with
  // the disk row's own cwd and the model currently picked in this panel.
  // A `warning` on the 201 is informational (engine resumed with a caveat),
  // so it goes to the notice channel, not the error one.
  const resumeDiskSession = async (info: DiskSessionInfo) => {
    if (creating || !model) return;
    const slash = model.indexOf('/');
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    setCreating(true);
    try {
      const { session, warning } = await createSession(
        { provider, modelId },
        info.cwd,
        info.path,
      );
      setCurrent(session.id);
      loadActive(session.id);
      setViewingDisk(null);
      itemsReqRef.current++; // discard any in-flight transcript of the old view
      setItems([]);
      if (warning) setNotice(warning);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const openHistory = useCallback(
    (s: SessionSummary) => {
      setCurrent(s.id);
      setViewingDisk(null);
      setItems([]);
      loadActive(s.id);
      // Stats alone leave a reopened session looking empty until the next
      // frame; replay the persisted transcript too.
      loadTranscript(s.id);
    },
    [loadActive, loadTranscript],
  );

  // Deep link (#/sessions/<id>): auto-open that session once, resolving it
  // through listSessions so the sidebar state stays honest. A target the
  // backend no longer knows is LOUD, never silently ignored.
  const deepOpenedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = initialSessionId;
    if (!id || deepOpenedRef.current === id) return;
    deepOpenedRef.current = id;
    listSessions()
      .then((r) => {
        const s = r.sessions.find((x) => x.id === id);
        if (s) openHistory(s);
        else setError(`Session “${id}” is not live — nothing to open.`);
      })
      .catch((e) => setError((e as Error).message));
  }, [initialSessionId, openHistory]);

  const openDiskSession = async (info: DiskSessionInfo) => {
    const reqId = ++itemsReqRef.current;
    try {
      const { transcript } = await readDiskSession(info.path);
      if (itemsReqRef.current !== reqId) return; // superseded by a newer open
      setItems(fromMessages(transcript.messages));
      setViewingDisk(info.path);
      setCurrent(null);
    } catch (e) {
      if (itemsReqRef.current !== reqId) return;
      setError((e as Error).message);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || !current) return;
    const sid = current;
    setItems((it) => appendUser(it, text));
    try {
      await promptSession(sid, text);
    } catch (e) {
      // The optimistic bubble has no accepted turn behind it — say so in the
      // transcript instead of silently waiting for a reply that never comes.
      setItems((it) => appendMeta(it, '⚠ message not delivered'));
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
    itemsReqRef.current++; // drop in-flight reads for the disposed view
    setCurrent(null);
    setViewingDisk(null);
    setItems([]);
    refresh();
  };

  // Client-side filter over the already-loaded persisted list only.
  const filteredDisk = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? diskSessions.filter((s) =>
          `${s.displayName ?? ''} ${s.name} ${s.id} ${s.cwd}`.toLowerCase().includes(q),
        )
      : diskSessions;
    return list.slice(0, 60);
  }, [diskSessions, query]);

  const modelFull = activeModel || model;
  const modelShort = modelFull.length > 26 ? `…${modelFull.slice(-26)}` : modelFull;

  return (
    <div className="fill chat-page" style={{ display: 'flex', flexDirection: 'row', gap: 'var(--s-4)' }}>
      <div style={{ flexBasis: 300, flexShrink: 0, width: 300 }} className="panel">
        <div className="chat-header">
          <span style={{ fontWeight: 600 }}>Sessions</span>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 11 }}>
            {sessions.length} live · {diskSessions.length} on disk
          </span>
        </div>
        <div className="panel-scroll" style={{ padding: 'var(--s-3)' }}>
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
          <button
            className="btn primary"
            style={{ width: '100%' }}
            onClick={openSession}
            disabled={creating}
            aria-label="New session"
          >
            <Icon name="plus" size={14} /> {creating ? 'Creating…' : 'New session'}
          </button>
          <div style={{ marginTop: 'var(--s-3)' }}>
            <CwdPicker value={cwd} onSelect={setCwd} placeholder="workspace root (host)" />
          </div>

          <div
            style={{
              margin: 'var(--s-4) 0 var(--s-2)',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: 'var(--text-faint)',
            }}
          >
            Live ({sessions.length})
          </div>
          <div className="stack">
            {sessions.map((s) => (
              <div key={s.id} className="row" style={{ alignItems: 'center' }}>
                <button
                  className="selectable-row"
                  style={{ flex: 1, minWidth: 0 }}
                  aria-pressed={current === s.id}
                  onClick={() => openHistory(s)}
                  title={`Open session ${s.id}`}
                >
                  <span
                    className="mono"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 12,
                    }}
                  >
                    {s.id.slice(0, 8)}
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {fmtRelative(s.createdAt)}
                  </span>
                  <StatusPill tone={STATUS_TONE[s.status] ?? 'idle'} dot={s.status === 'running'}>
                    {s.status}
                  </StatusPill>
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="muted" style={{ fontSize: 12 }}>
                No live sessions yet —{' '}
                <button
                  className="btn ghost sm"
                  onClick={openSession}
                  disabled={creating}
                  style={{ padding: '0 4px', height: 'auto' }}
                >
                  start one
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              margin: 'var(--s-4) 0 var(--s-2)',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: 'var(--text-faint)',
            }}
          >
            Persisted (omp on disk)
          </div>
          <span className="search" style={{ marginBottom: 'var(--s-2)' }}>
            <span className="search-icon">
              <Icon name="search" size={14} />
            </span>
            <input
              className="input"
              placeholder="Search persisted…"
              aria-label="Search persisted sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <div className="stack">
            {filteredDisk.map((s) => (
              <div key={s.path} className="row" style={{ gap: 'var(--s-2)' }}>
                <button
                  className="selectable-row"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                  }}
                  aria-pressed={viewingDisk === s.path}
                  onClick={() => openDiskSession(s)}
                  title={s.path}
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
                    {s.displayName || s.name || s.id}
                  </span>
                  <span
                    className="muted mono"
                    style={{
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 11,
                    }}
                  >
                    {s.cwd}
                    {s.modified ? ` · ${fmtRelative(s.modified)}` : ''}
                  </span>
                </button>
                <button
                  className="btn sm"
                  onClick={() => void resumeDiskSession(s)}
                  disabled={creating || !model}
                  title={
                    model
                      ? `Resume as a new live session (${model})`
                      : 'Select a model first — resume needs one'
                  }
                  aria-label={`Resume persisted session ${s.displayName || s.name || s.id}`}
                >
                  <Icon name="play" size={13} /> Resume
                </button>
              </div>
            ))}
            {filteredDisk.length === 0 &&
              (diskSessions.length === 0 ? (
                <EmptyState
                  icon="sessions"
                  title="No persisted sessions"
                  message="omp sessions saved to disk for this working directory appear here."
                />
              ) : (
                <EmptyState
                  icon="search"
                  title="No matches"
                  message={`Nothing matches “${query.trim()}”.`}
                  action={
                    <button className="btn ghost sm" onClick={() => setQuery('')}>
                      Clear search
                    </button>
                  }
                />
              ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }} className="panel">
        <ChatConsole
          items={items}
          onSend={send}
          stats={activeStats}
          model={activeModel}
          sendDisabled={!current}
          sendDisabledReason={
            viewingDisk ? 'Viewing a persisted transcript — open a live session to prompt' : 'No active session'
          }
          emptyState={
            <EmptyState
              icon="sessions"
              title="No active session"
              message="Create or select a session to start prompting."
              action={
                <button className="btn primary" onClick={openSession} disabled={creating}>
                  <Icon name="plus" size={14} /> New session
                </button>
              }
            />
          }
          header={
            <>
              <span
                style={{
                  fontWeight: 600,
                  maxWidth: 280,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={current ?? viewingDisk ?? undefined}
              >
                {current ?? viewingDisk ?? 'No active session'}
              </span>
              {current && <CopyButton text={current} title="Copy session id" />}
              {!viewingDisk && (
                <span title={modelFull}>
                  <StatusPill tone="info">{modelShort}</StatusPill>
                </span>
              )}
              {viewingDisk && <StatusPill tone="idle">persisted transcript</StatusPill>}
              <div className="spacer" />
              <StatusPill tone={wsState === 'open' ? 'ok' : 'running'} dot>
                {wsState === 'open' ? 'live' : 'connecting'}
              </StatusPill>
              {current && (
                <>
                  <button className="btn sm" onClick={doCompact} title="Compact the session context">
                    Compact
                  </button>
                  <ConfirmButton onConfirm={close} title="Dispose this session">
                    Dispose
                  </ConfirmButton>
                </>
              )}
            </>
          }
        />
      </div>

      {error && (
        <div
          className="card"
          role="alert"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 10,
            borderColor: 'var(--error)',
          }}
        >
          <span className="muted">{error}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {notice && (
        <div
          className="card"
          role="status"
          style={{
            position: 'fixed',
            right: 16,
            bottom: error ? 84 : 16,
            zIndex: 10,
            borderColor: 'var(--info)',
          }}
        >
          <span className="muted">{notice}</span>
          <button className="btn" style={{ marginLeft: 8 }} onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
