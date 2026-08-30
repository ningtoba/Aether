/**
 * ChatConsole — omp-style chat transcript renderer.
 *
 * Renders the same content omp's TUI shows, in a browser: assistant and user
 * text as markdown (headings, lists, tables, code with syntax highlighting),
 * thinking as a collapsible dimmed block, tool calls as rich panels with their
 * arguments and results, meta lines for turn boundaries, a streaming cursor,
 * and an optional status line (model, token totals, context usage) at the
 * bottom — mirroring omp's status bar.
 *
 * Uses react-markdown (a real markdown renderer) rather than hand-rolled text
 * formatting, so what the agent replies with formats the way it does in omp.
 * Styles live in ../chat.css (imported here so any host screen gets them).
 */
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatItem } from '../lib/chat';
import { EmptyState, Icon, StatusPill, fmtCompact } from './ui';
import '../chat.css';

export interface ChatStats {
  messages: number;
  toolCalls: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  context?: { tokens: number; contextWindow: number; percent: number };
}

export interface ChatConsoleProps {
  items: ChatItem[];
  header?: React.ReactNode;
  /** When provided, renders the input bar and calls this on send. */
  onSend?: (text: string) => void;
  /** Session stats for the status line (model/tokens/context). */
  stats?: ChatStats | null;
  /** Model label for the status line (falls back to nothing). */
  model?: string;
  autoScrolling?: boolean;
  /** Disable the input+Send entirely (e.g. no active session / persisted view). */
  sendDisabled?: boolean;
  /** Why sending is disabled (surfaced as the Send button's title). */
  sendDisabledReason?: string;
  /** Replaces the default "no messages" empty state (e.g. actionable CTA). */
  emptyState?: React.ReactNode;
}

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(iv);
  }, [intervalMs]);
  return now;
}

/** Markdown body with GFM + code highlighting; loose on partial/streamed md. */
export function Md({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-line">
      <button
        className="chat-thinking-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? 'collapse thinking' : 'expand thinking'}
      >
        <Icon name="brain" size={12} />
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className="chat-thinking-label">thinking</span>
        {streaming && <span className="chat-cursor" />}
      </button>
      {open && <div className="chat-thinking">{text}</div>}
    </div>
  );
}

function ToolBlock({
  name,
  args,
  result,
  isError,
}: {
  name: string;
  args?: string;
  result?: string;
  isError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const resultRef = useRef<HTMLPreElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  // For bash/exec tools the args are the command — show them as the primary
  // line instead of hiding behind a toggle.
  const showArgsInline = name === 'bash' || name === 'python';

  // Detect whether the (height-capped) result scrolls, to offer show more.
  useEffect(() => {
    const el = resultRef.current;
    if (!expanded && el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [result, expanded]);

  const canToggleResult = expanded || overflowing;
  return (
    <div className={`chat-tool${isError ? ' is-error' : ''}`}>
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="chat-tool-name">
          <Icon name="wrench" size={13} /> {name}
        </span>
        {!showArgsInline && args ? (
          <button className="btn sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'hide args' : 'args'}
          </button>
        ) : null}
        {result !== undefined && (
          <span className="chat-tool-status">
            <StatusPill tone={isError ? 'error' : 'ok'}>{isError ? 'error' : 'ok'}</StatusPill>
          </span>
        )}
      </div>
      {showArgsInline && args ? <div className="chat-tool-args">{args}</div> : null}
      {!showArgsInline && args && open ? <div className="chat-tool-args">{args}</div> : null}
      {result !== undefined && (
        <pre
          ref={resultRef}
          className={`chat-tool-result${isError ? ' is-error' : ''}${expanded ? ' expanded' : ''}`}
          style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
          title={result}
        >
          {result}
        </pre>
      )}
      {result !== undefined && canToggleResult && (
        <button
          className="chat-tool-more"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  );
}

function Line({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-line">
          <div className="chat-role user">you</div>
          <div className="md user">
            <Md text={item.text} />
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="chat-line">
          <div className="chat-role assistant">assistant</div>
          <Md text={item.text + (item.streaming ? ' ▌' : '')} />
        </div>
      );
    case 'thinking':
      return <ThinkingBlock text={item.text} streaming={item.streaming} />;
    case 'tool':
      return (
        <div className="chat-line">
          <ToolBlock
            name={item.name}
            args={item.args}
            result={item.result}
            isError={item.isError}
          />
        </div>
      );
    case 'meta':
      return <div className="chat-text meta">{item.text}</div>;
  }
}

function StatusLine({ stats, model }: { stats?: ChatStats | null; model?: string }) {
  if (!stats) return null;
  const ctx = stats.context;
  const pct = ctx ? Math.round(ctx.percent) : null;
  return (
    <div className="status-line">
      <span className="muted">status</span>
      {model && <StatusPill tone="info">{model}</StatusPill>}
      <span className="muted">{stats.messages} msgs</span>
      <span className="muted">tokens 𐄂 {fmtCompact(stats.tokens.total)}</span>
      {(stats.tokens.input > 0 || stats.tokens.output > 0) && (
        <span className="muted">
          in {fmtCompact(stats.tokens.input)} · out {fmtCompact(stats.tokens.output)}
        </span>
      )}
      {stats.toolCalls > 0 && <span className="muted">{stats.toolCalls} tool calls</span>}
      {ctx && pct !== null && (
        <span title={`context ${ctx.tokens} / ${ctx.contextWindow}`}>
          <StatusPill tone={pct > 85 ? 'warn' : 'idle'} dot>
            ctx {fmtCompact(ctx.tokens)}/{fmtCompact(ctx.contextWindow)} ({pct}%)
          </StatusPill>
        </span>
      )}
    </div>
  );
}

export function ChatConsole({
  items,
  header,
  onSend,
  stats,
  autoScrolling = true,
  model,
  sendDisabled = false,
  sendDisabledReason,
  emptyState,
}: ChatConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [draft, setDraft] = useState('');
  useNow(1000); // re-render to refresh timestamps/status

  // Auto-scroll only while the user is near the bottom — scrolling up to read
  // history must not be yanked back by the next streamed delta.
  useEffect(() => {
    if (autoScrolling && nearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, autoScrolling]);

  const trackProximity = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || sendDisabled) return;
    onSend?.(text);
    setDraft('');
  };

  const sendReady = !sendDisabled && draft.trim().length > 0;

  return (
    <div className="chat">
      {header && <div className="chat-header">{header}</div>}
      <div className="chat-scroll" ref={scrollRef} onScroll={trackProximity}>
        {items.length === 0 &&
          (emptyState ?? (
            <EmptyState
              icon="sessions"
              title="No messages yet"
              message="Prompts, replies, thinking and tool calls appear here as they stream."
            />
          ))}
        {items.map((it) => (
          <Line key={it.id} item={it} />
        ))}
      </div>
      {onSend && (
        <div className="chat-input">
          <textarea
            className="textarea"
            rows={2}
            placeholder="Prompt the agent… (Enter sends · Shift+Enter newline)"
            aria-label="Prompt message"
            value={draft}
            disabled={sendDisabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              // IME safety: never fire on Enter while a composition is active.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              submit();
            }}
          />
          <button
            className="btn primary"
            onClick={submit}
            disabled={!sendReady}
            title={sendDisabled ? (sendDisabledReason ?? 'Sending is unavailable') : 'Send prompt'}
          >
            <Icon name="send" size={14} /> Send
          </button>
        </div>
      )}
      {stats && <StatusLine stats={stats} model={model} />}
    </div>
  );
}
