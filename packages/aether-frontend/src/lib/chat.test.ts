/**
 * Unit tests for the pure chat transcript reducer (chat.ts).
 *
 * NOTE: chat.ts mints ids from a module-level counter shared across the whole
 * test file, so these tests assert item KINDS/TEXT/LENGTH and id uniqueness —
 * never exact id values.
 */
import { describe, expect, it } from 'vitest';
import type { RealtimeFrame } from './realtime';
import {
  appendMeta,
  appendUser,
  fromMessages,
  fromTranscriptEntries,
  reduceChatFrame,
  type ChatItem,
} from './chat';

const TRUNCATION_NOTICE = 'earlier items truncated';

function frame(
  event: Record<string, unknown> & { kind?: string },
  namespace: RealtimeFrame['payload']['namespace'] = 'session',
): RealtimeFrame {
  return { type: 'engine', payload: { namespace, event }, timestamp: '2026-08-30T12:00:00.000Z' };
}

function userItems(n: number, prefix = 'm'): ChatItem[] {
  let items: ChatItem[] = [];
  for (let i = 1; i <= n; i++) items = appendUser(items, `${prefix}${i}`);
  return items;
}

describe('reduceChatFrame — frame routing', () => {
  it('returns the identical array for non-session namespaces and unknown event kinds', () => {
    const items = userItems(2);
    // loop/hub frames must never touch the session transcript.
    expect(reduceChatFrame(items, frame({ kind: 'loop_round' }, 'loop'))).toBe(items);
    expect(reduceChatFrame(items, frame({ kind: 'hub' }, 'hub'))).toBe(items);
    // A session frame with an unknown/missing kind is a no-op too (default branch).
    expect(reduceChatFrame(items, frame({ kind: 'no_such_event' }))).toBe(items);
    expect(reduceChatFrame(items, frame({}))).toBe(items);
    // And it never corrupts prior state.
    const after = reduceChatFrame(items, frame({ kind: 'no_such_event' }));
    expect(after.map((i) => i.kind)).toEqual(['user', 'user']);
  });

  it('turn_start appends a turn-boundary meta item', () => {
    const out = reduceChatFrame([], frame({ kind: 'turn_start' }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('meta');
    expect(out[0]).toMatchObject({ text: '── turn start ──' });
  });
});

describe('reduceChatFrame — message_update', () => {
  it('opens a streaming assistant block and coalesces same-kind deltas in place', () => {
    let items = reduceChatFrame(
      [],
      frame({ kind: 'message_update', role: 'assistant', delta: 'Hel' }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('assistant');
    expect(items[0]).toMatchObject({ text: 'Hel', streaming: true });

    items = reduceChatFrame(
      items,
      frame({ kind: 'message_update', role: 'assistant', delta: 'lo' }),
    );
    expect(items).toHaveLength(1); // merged into the current block, not a second item
    expect(items[0]).toMatchObject({ text: 'Hello', streaming: true });
  });

  it('no-ops (same array reference) on empty or non-string deltas', () => {
    const items = reduceChatFrame([], frame({ kind: 'message_update', delta: 'keep' }));
    expect(reduceChatFrame(items, frame({ kind: 'message_update', delta: '' }))).toBe(items);
    expect(reduceChatFrame(items, frame({ kind: 'message_update' }))).toBe(items); // missing delta
    expect(reduceChatFrame(items, frame({ kind: 'message_update', delta: 42 }))).toBe(items);
  });

  it('thinking deltas open/merge a thinking item and a role switch starts a NEW item', () => {
    let items = reduceChatFrame(
      [],
      frame({ kind: 'message_update', role: 'thinking', delta: 'th' }),
    );
    expect(items[0].kind).toBe('thinking');
    items = reduceChatFrame(
      items,
      frame({ kind: 'message_update', role: 'thinking', delta: 'ink' }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'thinking', text: 'think', streaming: true });

    // Role switch must NOT append into the wrong (thinking) block.
    items = reduceChatFrame(
      items,
      frame({ kind: 'message_update', role: 'assistant', delta: 'answer' }),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'thinking', text: 'think' });
    expect(items[1]).toMatchObject({ kind: 'assistant', text: 'answer', streaming: true });

    // Any role other than 'thinking' is treated as assistant.
    const other = reduceChatFrame(
      [],
      frame({ kind: 'message_update', role: 'system', delta: 'x' }),
    );
    expect(other[0].kind).toBe('assistant');
  });
});

describe('reduceChatFrame — message_end / agent_end', () => {
  it('message_end finalizes the streaming assistant with the authoritative text', () => {
    let items = reduceChatFrame([], frame({ kind: 'message_update', delta: 'Hel' }));
    items = reduceChatFrame(items, frame({ kind: 'message_end', text: 'Hello world' }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant', text: 'Hello world', streaming: false });
  });

  it('message_end keeps the streamed text when the final text is empty or missing', () => {
    const streamed = reduceChatFrame([], frame({ kind: 'message_update', delta: 'streamed' }));
    const withEmpty = reduceChatFrame(streamed, frame({ kind: 'message_end', text: '' }));
    expect(withEmpty[0]).toMatchObject({ text: 'streamed', streaming: false });
    const withoutText = reduceChatFrame(streamed, frame({ kind: 'message_end' }));
    expect(withoutText[0]).toMatchObject({ text: 'streamed', streaming: false });
  });

  it('message_end with a non-assistant tail appends a closed assistant item; empty text is a no-op', () => {
    const thinkingTail = reduceChatFrame(
      [],
      frame({ kind: 'message_update', role: 'thinking', delta: 't' }),
    );
    const appended = reduceChatFrame(thinkingTail, frame({ kind: 'message_end', text: 'final' }));
    expect(appended).toHaveLength(2); // thinking tail is untouched, new closed item follows
    expect(appended[0]).toMatchObject({ kind: 'thinking', text: 't' });
    expect(appended[1]).toMatchObject({ kind: 'assistant', text: 'final', streaming: false });

    expect(reduceChatFrame(thinkingTail, frame({ kind: 'message_end', text: '' }))).toBe(
      thinkingTail,
    );
  });

  it('agent_end clears streaming only when the tail is assistant/thinking', () => {
    const assistantTail = reduceChatFrame([], frame({ kind: 'message_update', delta: 'hi' }));
    const closed = reduceChatFrame(assistantTail, frame({ kind: 'agent_end' }));
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ kind: 'assistant', streaming: false });

    const thinkingTail = reduceChatFrame(
      assistantTail,
      frame({ kind: 'message_update', role: 'thinking', delta: 't' }),
    );
    const closedThink = reduceChatFrame(thinkingTail, frame({ kind: 'agent_end' }));
    expect(closedThink[1]).toMatchObject({ kind: 'thinking', streaming: false });

    // Tool and meta tails are untouched (same array back); empty transcript too.
    const toolTail = reduceChatFrame([], frame({ kind: 'tool_call', name: 'bash' }));
    expect(reduceChatFrame(toolTail, frame({ kind: 'agent_end' }))).toBe(toolTail);
    const metaTail = appendMeta([], 'round 1');
    expect(reduceChatFrame(metaTail, frame({ kind: 'agent_end' }))).toBe(metaTail);
    const empty: ChatItem[] = [];
    expect(reduceChatFrame(empty, frame({ kind: 'agent_end' }))).toBe(empty);
  });
});

describe('reduceChatFrame — tool_call / tool_result', () => {
  it('tool_call opens a streaming tool item and coerces missing name/args to empty strings', () => {
    const bare = reduceChatFrame([], frame({ kind: 'tool_call' }));
    expect(bare).toHaveLength(1);
    expect(bare[0]).toMatchObject({ kind: 'tool', name: '', args: '', streaming: true });

    const full = reduceChatFrame([], frame({ kind: 'tool_call', name: 'read', args: '{"p":1}' }));
    expect(full[0]).toMatchObject({ kind: 'tool', name: 'read', args: '{"p":1}', streaming: true });
    // Non-string args are coerced to '' (only string args survive).
    const objArgs = reduceChatFrame([], frame({ kind: 'tool_call', name: 'read', args: { p: 1 } }));
    expect(objArgs[0]).toMatchObject({ args: '' });
  });

  it('tool_result attaches in place to the most recent OPEN tool with the same name', () => {
    let items = reduceChatFrame([], frame({ kind: 'tool_call', name: 'read', args: 'a1' }));
    const toolId = items[0].id;
    items = reduceChatFrame(items, frame({ kind: 'tool_result', name: 'read', content: 'ok' }));
    expect(items).toHaveLength(1); // updated, not appended
    expect(items[0]).toMatchObject({
      id: toolId, // in-place update preserves the item id
      kind: 'tool',
      name: 'read',
      result: 'ok',
      isError: false,
      streaming: false,
    });

    // Two same-name calls: the second result lands on the second (open) tool.
    let two = reduceChatFrame([], frame({ kind: 'tool_call', name: 'bash', args: 'first' }));
    two = reduceChatFrame(two, frame({ kind: 'tool_result', name: 'bash', content: 'r1' }));
    two = reduceChatFrame(two, frame({ kind: 'tool_call', name: 'bash', args: 'second' }));
    two = reduceChatFrame(two, frame({ kind: 'tool_result', name: 'bash', content: 'r2' }));
    expect(two).toHaveLength(2);
    expect(two[0]).toMatchObject({ args: 'first', result: 'r1' });
    expect(two[1]).toMatchObject({ args: 'second', result: 'r2' });
  });

  it('tool_result with no matching open tool appends a standalone closed item; isError and content defaults apply', () => {
    const readTool = reduceChatFrame([], frame({ kind: 'tool_call', name: 'read' }));
    // Different name → cannot attach (the open read tool stays open).
    const out = reduceChatFrame(
      readTool,
      frame({ kind: 'tool_result', name: 'bash', content: 'boom', isError: true }),
    );
    expect(out).toHaveLength(2);
    // The open read tool stays open — and note the reducer OMITS the result
    // key entirely on tool_call items (vs fromTranscriptEntries which sets it).
    const openTool = out[0];
    expect(openTool).toMatchObject({ kind: 'tool', name: 'read', streaming: true });
    if (openTool.kind === 'tool') {
      expect('result' in openTool).toBe(false);
    } else {
      throw new Error('expected a tool item');
    }
    expect(out[1]).toMatchObject({
      kind: 'tool',
      name: 'bash',
      result: 'boom',
      isError: true,
      streaming: false,
    });

    // A previously closed same-name tool is NOT reopened; non-string content → ''.
    const orphan = reduceChatFrame([], frame({ kind: 'tool_result', name: 'x' }));
    expect(orphan[0]).toMatchObject({
      kind: 'tool',
      name: 'x',
      result: '',
      isError: false,
      streaming: false,
    });
  });
});

describe('reduceChatFrame — session_error', () => {
  it('appends a warning meta line with the message (missing message renders empty)', () => {
    const out = reduceChatFrame([], frame({ kind: 'session_error', message: 'engine down' }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'meta', text: '⚠ error: engine down' });
    const bare = reduceChatFrame([], frame({ kind: 'session_error' }));
    expect(bare[0]).toMatchObject({ kind: 'meta', text: '⚠ error: ' });
  });
});

describe('capTranscript behavior via the public API', () => {
  it('holds at exactly 2000 items with no notice while under/equal the cap', () => {
    const items = userItems(2000);
    expect(items).toHaveLength(2000);
    expect(items.every((i) => i.kind === 'user')).toBe(true);
  });

  it('on the 2001st item trims from the FRONT behind a stable truncation notice', () => {
    const capped = userItems(2001);
    expect(capped).toHaveLength(2000);
    expect(capped[0]).toMatchObject({ kind: 'meta', text: TRUNCATION_NOTICE });
    // Oldest real items (m1, m2) dropped; newest 1999 kept at the tail.
    expect(capped[1]).toMatchObject({ kind: 'user', text: 'm3' });
    expect(capped[1999]).toMatchObject({ kind: 'user', text: 'm2001' });

    // Further overflow reuses the SAME notice object (stable id → no remount churn).
    const again = appendUser(capped, 'm2002');
    expect(again).toHaveLength(2000);
    expect(again[0]).toBe(capped[0]);
    expect(again[1]).toMatchObject({ text: 'm4' });
    expect(again[1999]).toMatchObject({ text: 'm2002' });
  });

  it('caps reconstructed transcripts too (fromMessages beyond 2000)', () => {
    const messages = Array.from({ length: 2001 }, (_, i) => ({ role: 'user', text: `t${i}` }));
    const items = fromMessages(messages);
    expect(items).toHaveLength(2000);
    expect(items[0]).toMatchObject({ kind: 'meta', text: TRUNCATION_NOTICE });
    expect(items[1]).toMatchObject({ kind: 'user', text: 't2' }); // oldest dropped from the front
  });
});

describe('appendUser / appendMeta', () => {
  it('append the expected item kinds with unique ids (counter is module-global)', () => {
    let items = appendUser([], 'go');
    items = appendMeta(items, 'round 1');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'go' });
    expect(items[1]).toMatchObject({ kind: 'meta', text: 'round 1' });
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(2);

    // ids keep growing uniquely across calls (never assert exact values).
    const more = appendUser(items, 'again');
    expect(new Set([...ids, more[2].id]).size).toBe(3);
  });
});

describe('fromMessages', () => {
  it('maps user → user and every other role → assistant, preserving text order', () => {
    const items = fromMessages([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
      { role: 'system', text: 'ctx' }, // non-user roles render as assistant blocks
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'assistant']);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'hi' });
    expect(items[1]).toMatchObject({ kind: 'assistant', text: 'hello' });
    expect(items[2]).toMatchObject({ kind: 'assistant', text: 'ctx' });
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('empty message list yields an empty transcript', () => {
    expect(fromMessages([])).toEqual([]);
  });
});

describe('fromTranscriptEntries', () => {
  it('round-trips all five entry kinds with the documented defaults', () => {
    const items = fromTranscriptEntries([
      { kind: 'user', text: 'u' },
      { kind: 'assistant', text: 'a' },
      { kind: 'thinking', text: 't' },
      { kind: 'tool', name: 'read', args: '{"p":1}', result: 'ok', isError: true },
      { kind: 'meta', text: 'm' },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'thinking', 'tool', 'meta']);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'u' });
    expect(items[1]).toMatchObject({ kind: 'assistant', text: 'a' });
    expect(items[2]).toMatchObject({ kind: 'thinking', text: 't' });
    expect(items[3]).toMatchObject({
      kind: 'tool',
      name: 'read',
      args: '{"p":1}',
      result: 'ok',
      isError: true,
    });
    expect(items[4]).toMatchObject({ kind: 'meta', text: 'm' });
  });

  it('defaults missing fields: text → "" and tool name → "tool"', () => {
    const items = fromTranscriptEntries([
      { kind: 'user' },
      { kind: 'assistant' },
      { kind: 'thinking' },
      { kind: 'tool' },
      { kind: 'meta' },
    ]);
    expect(items[0]).toMatchObject({ kind: 'user', text: '' });
    expect(items[1]).toMatchObject({ kind: 'assistant', text: '' });
    expect(items[2]).toMatchObject({ kind: 'thinking', text: '' });
    expect(items[3]).toMatchObject({
      kind: 'tool',
      name: 'tool',
      args: undefined,
      result: undefined,
      isError: undefined,
    });
    expect(items[4]).toMatchObject({ kind: 'meta', text: '' });
    expect(fromTranscriptEntries([])).toEqual([]);
  });
});
