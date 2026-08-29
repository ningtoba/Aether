/**
 * omp-style chat transcript model + reducer.
 *
 * The realtime frames from the engine (thinking deltas, tool call/result,
 * assistant text) are folded into a stable list of ChatItems here, mirroring
 * what the omp CLI surfaces in its TUI. Both the Sessions console and the Loop
 * inspector share this module so the rendering is identical everywhere.
 */
import type { RealtimeFrame } from './realtime';

export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; streaming?: boolean }
  | { id: string; kind: 'thinking'; text: string; streaming?: boolean }
  | {
      id: string;
      kind: 'tool';
      name: string;
      args?: string;
      result?: string;
      isError?: boolean;
      streaming?: boolean;
    }
  | { id: string; kind: 'meta'; text: string };

let nextId = 1;
function nid(): string {
  return `c${nextId++}`;
}

/** Append/update the transcript from one engine frame. Pure. */
export function reduceChatFrame(items: ChatItem[], frame: RealtimeFrame): ChatItem[] {
  if (frame.payload?.namespace !== 'session') return items;
  const ev = frame.payload.event as Record<string, unknown> & { kind?: string };
  const kind = ev?.kind;
  switch (kind) {
    case 'turn_start':
      return [...items, { id: nid(), kind: 'meta', text: '── turn start ──' }];
    case 'agent_end': {
      const last = items[items.length - 1];
      if (last && (last.kind === 'assistant' || last.kind === 'thinking')) {
        return [...items.slice(0, -1), { ...last, streaming: false }];
      }
      return items;
    }
    case 'message_update': {
      const role = ev.role === 'thinking' ? 'thinking' : 'assistant';
      const delta = typeof ev.delta === 'string' ? ev.delta : '';
      if (!delta) return items;
      const last = items[items.length - 1];
      if (last && last.kind === role) {
        // Streaming into the current block.
        return [...items.slice(0, -1), { ...last, text: last.text + delta, streaming: true }];
      }
      return [...items, { id: nid(), kind: role, text: delta, streaming: true }];
    }
    case 'message_end': {
      const text = typeof ev.text === 'string' ? String(ev.text) : '';
      const last = items[items.length - 1];
      if (last && last.kind === 'assistant') {
        // Finalize the streaming block with the authoritative full text.
        return [...items.slice(0, -1), { ...last, text: text || last.text, streaming: false }];
      }
      if (text) return [...items, { id: nid(), kind: 'assistant', text, streaming: false }];
      return items;
    }
    case 'tool_call': {
      const name = String(ev.name ?? '');
      return [
        ...items,
        {
          id: nid(),
          kind: 'tool',
          name,
          args: typeof ev.args === 'string' ? ev.args : '',
          streaming: true,
        },
      ];
    }
    case 'tool_result': {
      const name = String(ev.name ?? '');
      const content = typeof ev.content === 'string' ? ev.content : '';
      const isError = ev.isError === true;
      // Attach to the most recent tool item with the same name still open.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === 'tool' && it.name === name && it.result === undefined) {
          const next = [...items];
          next[i] = { ...it, result: content, isError, streaming: false };
          return next;
        }
      }
      return [
        ...items,
        {
          id: nid(),
          kind: 'tool',
          name,
          result: content,
          isError,
          streaming: false,
        } as ChatItem,
      ];
    }
    case 'session_error':
      return [...items, { id: nid(), kind: 'meta', text: `⚠ error: ${String(ev.message ?? '')}` }];
    default:
      return items;
  }
}

/** Append a user prompt (from the input box or a loop round). */
export function appendUser(items: ChatItem[], text: string): ChatItem[] {
  return [...items, { id: nid(), kind: 'user', text }];
}

/** Append a loop-round boundary (used by the loop inspector). */
export function appendMeta(items: ChatItem[], text: string): ChatItem[] {
  return [...items, { id: nid(), kind: 'meta', text }];
}

/**
 * Reconstruct a transcript from a persisted session's message list.
 * Rendered as assistant/user blocks (thinking not persisted per-line).
 */
export function fromMessages(
  messages: Array<{ role: string; text: string; timestamp?: string }>,
): ChatItem[] {
  return messages.map((m) => ({
    id: nid(),
    kind: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    text: m.text,
  }));
}
/** Convert a backend transcript entry to a ChatItem. */
export function fromTranscriptEntries(
  entries: Array<{
    kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'meta';
    text?: string;
    name?: string;
    args?: string;
    result?: string;
    isError?: boolean;
  }>,
): ChatItem[] {
  return entries.map((e) => {
    switch (e.kind) {
      case 'user':
        return { id: nid(), kind: 'user', text: String(e.text ?? '') };
      case 'assistant':
        return { id: nid(), kind: 'assistant', text: String(e.text ?? '') };
      case 'thinking':
        return { id: nid(), kind: 'thinking', text: String(e.text ?? '') };
      case 'tool':
        return {
          id: nid(),
          kind: 'tool',
          name: String(e.name ?? 'tool'),
          args: e.args,
          result: e.result,
          isError: e.isError,
        };
      case 'meta':
        return { id: nid(), kind: 'meta', text: String(e.text ?? '') };
    }
  });
}
