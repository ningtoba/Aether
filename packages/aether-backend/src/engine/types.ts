/**
 * Engine wire types — DTOs exchanged between the Aether backend and the web
 * GUI for the embedded omp/Pi agent engine (sessions, loops, skills, models).
 *
 * These are deliberately free of any `@oh-my-pi/pi-coding-agent` types so the
 * module graph compiles and runs under plain Node (the node vitest suite
 * never touches the omp SDK).
 */

/* ─── Models ─────────────────────────────────────────────────────────── */

export interface ModelRecord {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  baseUrl?: string;
  isEmbedded: boolean;
}

export interface ProviderModelGroup {
  provider: string;
  models: ModelRecord[];
}

/* ─── Sessions ───────────────────────────────────────────────────────── */

export type SessionStatus = 'idle' | 'running' | 'busy' | 'error' | 'closed';

export interface SessionSummary {
  id: string;
  name: string;
  cwd: string;
  model: { provider: string; modelId: string };
  status: SessionStatus;
  messageCount: number;
  createdAt: string;
  lastActivityAt?: string;
  /** Session totals for the GUI status line (messages/tokens/context). */
  stats?: {
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
  };
}

/** A single conversation turn event normalized for the GUI. */
export type SessionTurnEvent =
  | { kind: 'turn_start'; turn: number }
  | { kind: 'message_start'; role: 'user' | 'assistant' | 'system'; turn: number }
  | { kind: 'message_update'; role: 'assistant' | 'thinking'; delta: string; turn: number }
  | { kind: 'message_end'; role: 'assistant'; text: string; stopReason?: string; turn: number }
  | { kind: 'tool_call'; name: string; args?: string; turn?: number }
  | { kind: 'tool_result'; name: string; isError?: boolean; content?: string; turn?: number }
  | { kind: 'agent_end'; isTerminal: boolean }
  | { kind: 'session_error'; message: string };

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
}

/** Rich transcript entry reconstructed from an omp session journal. */
export type SessionTranscriptEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; args?: string; result?: string; isError?: boolean }
  | { kind: 'meta'; text: string };

export interface SessionTranscript {
  id: string;
  entries: SessionTranscriptEntry[];
}

/* ─── Loops ──────────────────────────────────────────────────────────── */

/** The transition that runs AFTER each round (user-configurable in the GUI).
 *  `[round N prompt] → [transition] → [round N+1]` */
export type LoopTransitionKind = 'none' | 'compact' | 'skill' | 'gate';

export interface LoopTransition {
  kind: LoopTransitionKind;
  /** Required when kind === 'skill' */
  skillName?: string;
}

export interface LoopDefinition {
  id: string;
  name: string;
  description?: string;
  /** The agent prompt executed every round (may contain {round} for the round number). */
  prompt: string;
  /** What to run between rounds. */
  transition: LoopTransition;
  /** Stop after this many rounds; 0 or undefined = no round cap (indefinite). */
  maxRounds?: number;
  /** Stop after this many ms since the loop started; 0/undefined = no time cap. */
  maxTimeMs?: number;
  cwd: string;
  /** Session model to run the loop on. */
  model: { provider: string; modelId: string };
}

export type LoopStatus = 'idle' | 'running' | 'gated' | 'stopped' | 'completed' | 'error';

export interface LoopRoundResult {
  round: number;
  startedAt: string;
  finishedAt: string;
  /** Final assistant text of the round. */
  summary?: string;
  /** True when the round ended with a model error. */
  errored: boolean;
}

export interface LoopProgress {
  id: string;
  status: LoopStatus;
  currentRound: number;
  rounds: LoopRoundResult[];
  startedAt?: string;
  stopReason?: string;
  /** Session the loop is running on (for live chat inspection). */
  sessionId?: string;
}

/** Emitted by the LoopRunner to the broadcast hub. */
export type LoopEvent =
  | { kind: 'loop:start'; loopId: string }
  | { kind: 'loop:round_start'; loopId: string; round: number }
  | { kind: 'loop:round_end'; loopId: string; round: number; summary?: string; errored: boolean }
  | { kind: 'loop:round_error'; loopId: string; round: number; message: string }
  | { kind: 'loop:transition'; loopId: string; round: number; transition: LoopTransition }
  | { kind: 'loop:gated'; loopId: string; round: number }
  | { kind: 'loop:stop'; loopId: string; reason: string }
  | { kind: 'loop:completed'; loopId: string; reason: string };

/* ─── Skills ─────────────────────────────────────────────────────────── */

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  /** The SKILL.md body (frontmatter stripped). */
  body: string;
  source: string;
}
