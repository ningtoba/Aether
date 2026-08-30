/**
 * LoopRunner contracts, driven directly (no manager indirection):
 *
 *  - EngineSession.prompt resolves 'ok' | 'busy' | 'error'. A round whose turn
 *    was rejected (busy) or failed (error) is recorded errored:true with NO
 *    summary: lastAssistantText still holds the PREVIOUS round's reply, and
 *    reusing it made a transient provider failure masquerade as delivered
 *    output (errored:false + stale summary).
 *  - skill transitions with non-empty args build the round instruction from
 *    the args template ({round} → 1-based round number) + blank line + skill
 *    body; args undefined/empty keeps the historical static prompt
 *    byte-identical (back-compat).
 *  - a skill transition whose prompt comes back busy/errored stops the loop
 *    instead of silently advancing it.
 *  - finish() must never clobber a stop reason already recorded by stop()
 *    ('manual stop' / 'time limit' landing on a gated or transitioning loop).
 */
import { describe, it, expect, vi } from 'vitest';
import { LoopRunner } from './loop-runner.js';
import type { EngineSession } from './engine-service.js';
import type { LoopDefinition, LoopEvent } from './types.js';

type Outcome = 'ok' | 'busy' | 'error';

const SKILL_BODY = 'BODY ONE\nline2';

/** EngineSession double honouring the prompt outcome contract: `outcomes` are
 *  consumed per call (the last entry repeats), and lastAssistantText only
 *  moves on 'ok' turns — exactly the stale state an errored round must not
 *  read its summary from. */
function scriptedSession(outcomes: Outcome[]) {
  const s = {
    id: 'ses_fake',
    status: 'idle' as const,
    lastAssistantText: 'PREVIOUS ROUND REPLY',
    prompts: [] as string[],
    prompt: async (text: string): Promise<Outcome> => {
      s.prompts.push(text);
      const outcome = outcomes[Math.min(s.prompts.length - 1, outcomes.length - 1)] ?? 'ok';
      if (outcome === 'ok') s.lastAssistantText = `reply after ${text.slice(0, 8)}`;
      return outcome;
    },
    compact: async () => {},
  };
  return { session: s as unknown as EngineSession, prompts: s.prompts };
}

function loopDef(over: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    id: 'l1',
    name: 'loop 1',
    prompt: 'work {round}',
    transition: { kind: 'none' },
    maxRounds: 1,
    cwd: '/tmp',
    model: { provider: 'p', modelId: 'm' },
    ...over,
  };
}

function makeRunner(def: LoopDefinition, session: EngineSession, events: LoopEvent[]) {
  return new LoopRunner(def, session, {
    onEvent: (ev) => events.push(ev),
    readSkill: async (name) => ({ name, body: SKILL_BODY }),
  });
}

function eventMessage(events: LoopEvent[]): string {
  const err = events.find((e) => e.kind === 'loop:round_error');
  return err !== undefined && 'message' in err ? err.message : '';
}

describe('LoopRunner — round integrity (prompt outcome contract)', () => {
  it('records a busy round as errored with a real reason and NEVER the stale summary', async () => {
    const { session, prompts } = scriptedSession(['busy', 'ok']);
    const events: LoopEvent[] = [];
    const runner = makeRunner(loopDef({ maxRounds: 2 }), session, events);
    await runner.start();

    // The loop stopped at the errored round — 'work 2' was never sent.
    expect(prompts).toEqual(['work 1']);
    const p = runner.progress;
    expect(p.totalRounds).toBe(1);
    expect(p.rounds).toHaveLength(1);
    expect(p.rounds[0].errored).toBe(true);
    // Discriminator: the pre-fix runner recorded errored:false and read the
    // session's still-stale lastAssistantText as this round's summary.
    expect(p.rounds[0].summary).toBeUndefined();
    expect(eventMessage(events)).toMatch(/busy/i);
    expect(p.stopReason).toBe('round errored');
    expect(p.status).toBe('stopped');
  });

  it('records an errored turn as errored with no summary', async () => {
    const { session } = scriptedSession(['error']);
    const events: LoopEvent[] = [];
    const runner = makeRunner(loopDef({ maxRounds: 2 }), session, events);
    await runner.start();

    expect(runner.progress.rounds[0].errored).toBe(true);
    expect(runner.progress.rounds[0].summary).toBeUndefined();
    expect(eventMessage(events)).toMatch(/errored or produced no output/);
    expect(runner.progress.stopReason).toBe('round errored');
  });

  it('keeps the healthy path honest: ok turns carry their own summary', async () => {
    const { session } = scriptedSession(['ok', 'ok']);
    const events: LoopEvent[] = [];
    const runner = makeRunner(loopDef({ maxRounds: 2 }), session, events);
    await runner.start();

    const p = runner.progress;
    expect(p.status).toBe('completed');
    expect(p.stopReason).toBe('max rounds reached');
    expect(p.totalRounds).toBe(2);
    // Round 2's own reply — not 'PREVIOUS ROUND REPLY'.
    expect(p.rounds[1].summary).toBe('reply after work 2');
  });
});

describe('LoopRunner — skill transition args (contract layout)', () => {
  it('args with {round} becomes the prompt header, blank line, then the skill body', async () => {
    const { session, prompts } = scriptedSession(['ok', 'ok']);
    const runner = makeRunner(
      loopDef({
        prompt: 'task {round}',
        maxRounds: 2,
        transition: { kind: 'skill', skillName: 'review', args: 'apply review to round {round}' },
      }),
      session,
      [],
    );
    await runner.start();

    // EXACT layout: substituted args line, one blank line, trimmed body.
    expect(prompts).toEqual(['task 1', `apply review to round 1\n\n${SKILL_BODY}`, 'task 2']);
  });

  it('replaces EVERY {round} occurrence with the 1-based round number', async () => {
    const { session, prompts } = scriptedSession(['ok', 'ok']);
    const runner = makeRunner(
      loopDef({
        maxRounds: 2,
        transition: { kind: 'skill', skillName: 's', args: 'r{round}x{round}' },
      }),
      session,
      [],
    );
    await runner.start();
    expect(prompts[1]).toBe(`r1x1\n\n${SKILL_BODY}`);
  });

  it('args undefined OR whitespace-only keep the historical static prompt byte-identical', async () => {
    const noArgs = scriptedSession(['ok', 'ok']);
    const runnerA = makeRunner(
      loopDef({ maxRounds: 2, transition: { kind: 'skill', skillName: 'review' } }),
      noArgs.session,
      [],
    );
    await runnerA.start();
    expect(noArgs.prompts[1]).toBe(
      `Apply the following skill and return the result:\n\n${SKILL_BODY}`,
    );

    const emptyArgs = scriptedSession(['ok', 'ok']);
    const runnerB = makeRunner(
      loopDef({ maxRounds: 2, transition: { kind: 'skill', skillName: 'review', args: '   ' } }),
      emptyArgs.session,
      [],
    );
    await runnerB.start();
    expect(emptyArgs.prompts[1]).toBe(
      `Apply the following skill and return the result:\n\n${SKILL_BODY}`,
    );
  });

  it('a skill prompt that comes back errored stops the loop with a loud reason', async () => {
    const { session, prompts } = scriptedSession(['ok', 'error']);
    const events: LoopEvent[] = [];
    const runner = makeRunner(
      loopDef({ maxRounds: 3, transition: { kind: 'skill', skillName: 'review' } }),
      session,
      events,
    );
    await runner.start();

    expect(prompts).toHaveLength(2); // round 2 was never started
    expect(eventMessage(events)).toMatch(/skill prompt failed/);
    expect(runner.progress.status).toBe('stopped');
    expect(runner.progress.stopReason).toBe('transition stop');
  });
});

describe('LoopRunner — finish() keeps the recorded stop reason', () => {
  it('a time-limit stop landing on a gated loop is reported as the time limit', async () => {
    const { session } = scriptedSession(['ok']);
    const events: LoopEvent[] = [];
    const runner = makeRunner(
      loopDef({ maxRounds: 5, transition: { kind: 'gate' } }),
      session,
      events,
    );
    const done = runner.start();
    await vi.waitFor(() => expect(runner.status).toBe('gated'));

    // The timer path: stop() records the REAL cause, then resolves the gate.
    await runner.stop('time limit');
    await done;

    // Discriminator: pre-fix finish('transition stop') overwrote state.reason,
    // so the GUI saw 'transition stop' for what was a timeout.
    expect(runner.progress.stopReason).toBe('time limit');
    const stopEv = events.find((e) => e.kind === 'loop:stop');
    expect(stopEv !== undefined && 'reason' in stopEv ? stopEv.reason : '').toBe('time limit');
  });
});
