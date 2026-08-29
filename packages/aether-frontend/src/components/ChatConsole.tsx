/**
 * ChatConsole — omp-style chat transcript renderer.
 *
 * Renders a list of ChatItems (user/assistant/thinking/tool/meta) the way the
 * omp CLI presents them: assistant + thinking streaming in distinct styles,
 * tool calls with their arguments and results in bordered blocks, meta lines
 * for turn boundaries, a pulsing cursor while streaming, and an optional
 * input bar. Auto-scrolls to the newest line.
 */
import React, { useEffect, useRef } from 'react';
import type { ChatItem } from '../lib/chat';

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
  return (
    <div className="chat-tool">
      <span className="chat-tool-name">🔧 {name}</span>
      {args ? <div className="chat-tool-args">{args}</div> : null}
      {result !== undefined && (
        <div className={`chat-tool-result${isError ? ' is-error' : ''}`}>{result}</div>
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
          <div className="chat-text user">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="chat-line">
          <div className="chat-role">assistant</div>
          <div className="chat-text assistant">
            {item.text}
            {item.streaming ? <span className="chat-cursor" /> : null}
          </div>
        </div>
      );
    case 'thinking':
      return (
        <div className="chat-line">
          <div className="chat-thinking-label">thinking</div>
          <div className="chat-thinking">
            {item.text}
            {item.streaming ? <span className="chat-cursor" /> : null}
          </div>
        </div>
      );
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

export interface ChatConsoleProps {
  items: ChatItem[];
  header?: React.ReactNode;
  /** When provided, renders the input bar and calls this on send. */
  onSend?: (text: string) => void;
  autoScrolling?: boolean;
}

export function ChatConsole({ items, header, onSend, autoScrolling = true }: ChatConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState('');

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
    </div>
  );
}
