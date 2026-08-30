/**
 * LoopRunner — the Aether "loop" primitive.
 *
 * A loop repeats an agent prompt on a persistent session, and after every round
 * runs the user-configured transition:
 *
 *     [round N prompt] → [transition] → [round N+1 prompt] → ...
 *
 * The transition is where workflow control happens:
 *   - `compact` → session.compact()   (e.g. [1st loop] → [compact] → [2nd loop])
 *   - `skill:name` → invoke a skill on the session
 *   - `gate` → pause; the GUI/user decides next (continue / stop / edit)
 *   - `none` → straight to the next round
 *
 * Stop conditions: maxRounds | maxTimeMs | manual stop. Rounds are otherwise
 * indefinite (the user's "run it indefinitely" requirement).
 */
import type {
  LoopDefinition,
  LoopEvent,
  LoopStatus,
  LoopRoundResult,
  LoopTransition,
} from './types.js';
import type { EngineSession } from './engine-service.js';

export interface LoopRunnerCallbacks {
  onEvent: (ev: LoopEvent) => void;
  /** Resolve a skill body given its name; returns null when unknown. */
  readSkill: (name: string) => Promise<{ name: string; body: string } | null>;
}

type GateAction = 'continue' | 'stop';

/** Retention window for rounds in the live progress state: an indefinite
 *  loop would otherwise grow this (and every serialized progress payload)
 *  forever. totalRounds keeps the true count outside the window. */
const MAX_RETAINED_ROUNDS = 200;
/** Per-round summary cap — a full assistant reply must not ride in every
 *  progress response. */
const ROUND_SUMMARY_MAX_CHARS = 2000;

/** Internal mutable runtime state for a loop run. */
interface LoopRunState {
  status: LoopStatus;
  reason?: string;
  rounds: LoopRoundResult[];
  /** Total rounds executed (survives the rounds retention window). */
  totalRounds: number;
  startedAt?: string;
  gateResolver: ((a: GateAction) => void) | null;
  stopped: boolean;
  currentRound: number;
}

export class LoopRunner {
  private definition: LoopDefinition;
  private session: EngineSession;
  private callbacks: LoopRunnerCallbacks;
  private state: LoopRunState;
  private generation = 0;
  private startWallMs = 0;
  /** Exactly one terminal finish() per run (cap / error / stop / mid-stop). */
  private finished = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(definition: LoopDefinition, session: EngineSession, callbacks: LoopRunnerCallbacks) {
    if (!definition.prompt || !definition.prompt.trim()) {
      throw new Error('Loop prompt is required');
    }
    this.definition = definition;
    this.session = session;
    this.callbacks = callbacks;
    this.state = {
      status: 'idle',
      rounds: [],
      totalRounds: 0,
      gateResolver: null,
      stopped: false,
      currentRound: 0,
    };
  }

  get id(): string {
    return this.definition.id;
  }

  get status(): LoopStatus {
    return this.state.status;
  }

  get progress(): {
    id: string;
    status: LoopStatus;
    currentRound: number;
    rounds: LoopRoundResult[];
    totalRounds: number;
    startedAt?: string;
    stopReason?: string;
    sessionId?: string;
  } {
    return {
      id: this.definition.id,
      status: this.state.status,
      currentRound: this.state.currentRound,
      rounds: this.state.rounds,
      totalRounds: this.state.totalRounds,
      startedAt: this.state.startedAt,
      stopReason: this.state.reason,
      sessionId: this.session.id,
    };
  }

  /** Start the loop; resolves when the loop stops/completes or an unrecoverable
   *  error is hit (gates included — the caller decides the gate). */
  async start(): Promise<void> {
    if (this.state.status === 'running' || this.state.status === 'gated') return;
    this.generation++;
    const gen = this.generation;
    this.state.status = 'running';
    this.state.startedAt = new Date().toISOString();
    this.state.stopped = false;
    this.finished = false;
    this.state.currentRound = 0;
    this.startWallMs = Date.now();
    this.emit({ kind: 'loop:start', loopId: this.id });

    // Time cap
    if (this.definition.maxTimeMs && this.definition.maxTimeMs > 0) {
      this.timer = setTimeout(() => void this.stop('time limit'), this.definition.maxTimeMs);
    }

    while (!this.state.stopped) {
      if (gen !== this.generation) return;

      // Round cap reached → completed. The transition only runs BETWEEN rounds
      // (a cap of N means exactly N rounds: `[r1] -> T -> [r2] -> ... -> [rN]`,
      // never a transition after the final round).
      if (this.definition.maxRounds && this.state.totalRounds >= this.definition.maxRounds) {
        return this.finish('max rounds reached');
      }

      const round = this.state.totalRounds + 1;
      this.state.currentRound = round;
      this.emit({ kind: 'loop:round_start', loopId: this.id, round });

      const roundResult = await this.runRound(round, gen);
      // Stopped mid-round (manual stop / time limit landed while the prompt
      // was still in flight): route through the normal finish path so the
      // timer is cleared, the status becomes terminal and the GUI receives
      // its loop:stop event. finish() is latched, so double-finish is safe.
      if (!roundResult) return this.finish(this.state.reason ?? 'stopped');
      this.state.totalRounds++;
      this.state.rounds.push(roundResult);
      // Keep only the retention window — totalRounds carries the truth, and
      // round numbering/caps read from it, never from the truncated array.
      if (this.state.rounds.length > MAX_RETAINED_ROUNDS) {
        this.state.rounds.splice(0, this.state.rounds.length - MAX_RETAINED_ROUNDS);
      }
      this.emit({
        kind: 'loop:round_end',
        loopId: this.id,
        round,
        summary: roundResult.summary,
        errored: roundResult.errored,
      });

      if (gen !== this.generation) return;
      if (this.state.stopped) return this.finish(this.state.reason ?? 'stopped');

      // Round error policy: stop the loop (a persistent error won't heal by
      // repeating the same prompt).
      if (roundResult.errored) {
        return this.finish('round errored');
      }

      // Transition between rounds — skipped when this was the final round.
      const isFinalRound = this.definition.maxRounds
        ? this.state.totalRounds >= this.definition.maxRounds
        : false;
      if (isFinalRound) return this.finish('max rounds reached');

      const transition = this.definition.transition ?? { kind: 'none' };
      const outcome = await this.runTransition(transition, round, gen);
      if (outcome === 'stop') return this.finish('transition stop');
      // 'continue' → next round.
    }

    // Fell out of the while condition: stopped between rounds (e.g. the stop
    // landed during a transition await) or ran dry — either way the normal
    // finish path owns the terminal transition.
    if (this.state.stopped) this.finish(this.state.reason ?? 'stopped');
    else if (this.state.status === 'running') this.finish('completed');
  }

  /** Run a single prompt round. Returns null when the loop should abort. */
  private async runRound(round: number, gen: number): Promise<LoopRoundResult | null> {
    const started = new Date().toISOString();
    const promptText = this.definition.prompt.replaceAll('{round}', String(round));
    try {
      await this.session.prompt(promptText);
      if (this.state.stopped || gen !== this.generation) return null;
      const summary = await this.sessionReadLastText();
      return {
        round,
        startedAt: started,
        finishedAt: new Date().toISOString(),
        summary,
        errored: false,
      };
    } catch (err) {
      this.emit({
        kind: 'loop:round_error',
        loopId: this.id,
        round,
        message: err instanceof Error ? err.message : String(err),
      });
      return { round, startedAt: started, finishedAt: new Date().toISOString(), errored: true };
    }
  }

  /** Execute the configured after-round transition. */
  private async runTransition(
    transition: LoopTransition,
    round: number,
    gen: number,
  ): Promise<'continue' | 'stop'> {
    this.emit({ kind: 'loop:transition', loopId: this.id, round, transition });

    switch (transition.kind) {
      case 'none':
        return 'continue';
      case 'compact':
        try {
          await this.session.compact(
            'Compact the conversation so the next round starts fresh but retains the project context.',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // A session too small to compact is a benign no-op, not a failure:
          // keep the loop running (the user asked for compact-after-round as
          // housekeeping, and an empty/short conversation has nothing to gain).
          if (/nothing to compact/i.test(message)) return 'continue';
          this.emit({
            kind: 'loop:round_error',
            loopId: this.id,
            round,
            message: `compact failed: ${message}`,
          });
          return 'stop';
        }
        return 'continue';
      case 'skill': {
        const skillName = transition.skillName?.trim();
        if (!skillName) return 'stop';
        const skill = await this.callbacks.readSkill(skillName);
        if (!skill) {
          this.emit({
            kind: 'loop:round_error',
            loopId: this.id,
            round,
            message: `skill not found: ${skillName}`,
          });
          return 'stop';
        }
        // Run the skill as an instruction on the same session. If the skill
        // body is empty, treat as a no-op transition.
        const body = skill.body.trim();
        if (body) {
          await this.session.prompt(`Apply the following skill and return the result:\n\n${body}`);
        }
        if (gen !== this.generation) return 'stop';
        return 'continue';
      }
      case 'gate': {
        // Pause until the GUI/user advances or stops.
        this.state.status = 'gated';
        this.emit({ kind: 'loop:gated', loopId: this.id, round });
        const action = await this.waitForGate();
        if (gen !== this.generation) return 'stop';
        if (action === 'stop') return 'stop';
        return 'continue';
      }
      default:
        return 'continue';
    }
  }

  /** Resolve the pending gate (from the GUI). Returns true on accept. */
  private waitForGate(): Promise<GateAction> {
    return new Promise<GateAction>((resolve) => {
      this.state.gateResolver = resolve;
    });
  }

  /** GUI calls this to continue past a gate. */
  continueOnceGate(): void {
    if (this.state.status !== 'gated') return;
    this.state.status = 'running';
    const r = this.state.gateResolver;
    this.state.gateResolver = null;
    r?.('continue');
  }

  /** GUI calls this to stop a gated loop. */
  stopOnceGate(): void {
    if (this.state.status !== 'gated') return;
    this.state.status = 'stopped';
    const r = this.state.gateResolver;
    this.state.gateResolver = null;
    r?.('stop');
  }

  /** Stop the loop (manual or from a gate). */
  async stop(reason = 'manual stop'): Promise<void> {
    if (this.state.stopped) return;
    this.state.stopped = true;
    this.state.reason = reason;
    // Clear the time-cap timer on EVERY stop path — finish() may never run
    // again for a stop that lands mid-round, and a live timer would fire a
    // second stop() into a loop that is already winding down.
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.state.status !== 'gated') {
      // Interrupt the current prompt by disposing the session prompt? The omp
      // SDK prompt() has no synchronous abort exposed here; instead we surface
      // the stop and let runRound's guard handle it on next yield. For gates we
      // resolve immediately.
    } else {
      const r = this.state.gateResolver;
      this.state.gateResolver = null;
      r?.('stop');
    }
  }

  /** Terminate the loop cleanly (after cap/error/transition-stop). */
  private finish(reason: string): void {
    if (this.finished) return; // exactly one terminal transition per run
    this.finished = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.state.reason = reason;
    this.state.status = reason === 'completed' ? 'completed' : 'stopped';
    if (reason === 'max rounds reached' || reason === 'completed') {
      this.state.status = 'completed';
      this.emit({ kind: 'loop:completed', loopId: this.id, reason });
    } else if (reason !== 'manual stop') {
      this.emit({ kind: 'loop:stop', loopId: this.id, reason });
    } else {
      this.emit({ kind: 'loop:stop', loopId: this.id, reason });
    }
  }

  /** Read the last assistant message text from the session (best-effort). */
  private async sessionReadLastText(): Promise<string | undefined> {
    const text = this.session.lastAssistantText?.trim();
    if (!text) return undefined;
    // This summary rides in every progress response and the round_end event —
    // an unbounded reply per round is an unbounded payload on indefinite
    // loops. Cap it; the head of the text stays readable.
    return text.length > ROUND_SUMMARY_MAX_CHARS
      ? `${text.slice(0, ROUND_SUMMARY_MAX_CHARS)}…`
      : text;
  }

  private emit(ev: LoopEvent): void {
    this.callbacks.onEvent(ev);
  }
}
