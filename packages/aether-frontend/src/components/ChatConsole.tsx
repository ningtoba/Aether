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
 */
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ChatItem } from '../lib/chat';

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
        title={open ? 'collapse' : 'expand'}
      >
        <span className="chat-thinking-label">{open ? '▼' : '▶'} thinking</span>
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
  // For bash/exec tools the args are the command — show them as the primary
  // line instead of hiding behind a toggle.
  const showArgsInline = name === 'bash' || name === 'python';
  return (
    <div className={`chat-tool${isError ? ' is-error' : ''}`}>
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="chat-tool-name">🔧 {name}</span>
        {!showArgsInline && args ? (
          <button
            className="btn"
            style={{ padding: '1px 8px', fontSize: 11 }}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'hide args' : 'args'}
          </button>
        ) : null}
        {result !== undefined && (
          <span className={`chat-tool-status${isError ? ' is-error' : ''}`}>
            {isError ? 'error' : 'ok'}
          </span>
        )}
      </div>
      {showArgsInline && args ? <div className="chat-tool-args">{args}</div> : null}
      {!showArgsInline && args && open ? <div className="chat-tool-args">{args}</div> : null}
      {result !== undefined && (
        <pre
          className={`chat-tool-result${isError ? ' is-error' : ''}`}
          style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
          title={result}
        >
          {result}
        </pre>
      )}
    </div>
  );
}

function Line({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat-line">
          <div className="chat-role">you</div>
          <div className="md user">
            <Md text={item.text} />
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="chat-line">
          <div className="chat-role">assistant</div>
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
      {model && <span className="tag">{model}</span>}
      <span className="muted">{stats.messages} msgs</span>
      <span className="muted">tokens 𐄂 {stats.tokens.total.toLocaleString()}</span>
      {(stats.tokens.input > 0 || stats.tokens.output > 0) && (
        <span className="muted">
          in {stats.tokens.input.toLocaleString()} · out {stats.tokens.output.toLocaleString()}
        </span>
      )}
      {stats.toolCalls > 0 && <span className="muted">{stats.toolCalls} tool calls</span>}
      {ctx && pct !== null && (
        <span className="tag" style={{ borderColor: pct > 85 ? 'var(--red)' : 'var(--border)' }}>
          ctx {Math.round(ctx.tokens / 1000)}k/{Math.round(ctx.contextWindow / 1000)}k ({pct}%)
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
}: ChatConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  useNow(1000); // re-render to refresh timestamps/status

  useEffect(() => {
    if (autoScrolling && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, autoScrolling]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text);
    setDraft('');
  };

  return (
    <div className="chat">
      {header && <div className="chat-header">{header}</div>}
      <div className="chat-scroll" ref={scrollRef}>
        {items.length === 0 && <div className="chat-text meta">(no messages yet)</div>}
        {items.map((it) => (
          <Line key={it.id} item={it} />
        ))}
      </div>
      {onSend && (
        <div className="chat-input">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Prompt the agent…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button className="btn primary" onClick={submit}>
            Send
          </button>
        </div>
      )}
      {stats && <StatusLine stats={stats} model={model} />}
    </div>
  );
}
