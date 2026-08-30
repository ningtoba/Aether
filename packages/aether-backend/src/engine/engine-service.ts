/**
 * EngineService — embedded agent engine for Aether.
 *
 * Wraps the `@oh-my-pi/pi-coding-agent` SDK (the MIT omp/Pi harness) so the
 * whole Aether backend can drive real agent sessions, loops, and skills from
 * the web GUI.
 *
 * IMPORTANT runtime boundary: the omp SDK only runs under Bun. This module
 * imports it lazily (via dynamic `import()`) inside `#load()` / `#session()`,
 * so the module itself compiles and loads under plain Node — the node vitest
 * suite never imports `@oh-my-pi/pi-coding-agent` and therefore never pulls in
 * the Bun-only native addon. All public methods that need the engine return a
 * strict `EngineUnavailableError` when running under Node.
 */
import * as fs from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import type { ModelRecord, ProviderModelGroup, SessionSummary, SessionTurnEvent } from './types.js';
import type { SessionTranscriptEntry } from './types.js';
import {
  ModelsYamlStore,
  PROVIDER_NAME_PATTERN,
  mergeNewProvider,
  mergeRemovedProvider,
  providerEntryIn,
  providerNamesIn,
  type CreateProviderInput,
  type YamlCodecs,
} from './providers-store.js';

/** Thrown when an engine operation is attempted but the omp SDK cannot run
 *  (e.g. backend running under plain Node, or install incomplete). */
export class EngineUnavailableError extends Error {
  constructor(
    message = 'Agent engine unavailable: requires the Bun runtime and @oh-my-pi/pi-coding-agent',
  ) {
    super(message);
    this.name = 'EngineUnavailableError';
  }
}

/** An error the engine raises ON PURPOSE with text the operator/GUI must
 *  see (catalog verdicts like "model not found" / "not served by the
 *  provider"). The route layer passes these messages through; anything else
 *  reaching a route is unexpected and gets a fixed response instead. */
export class EngineUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineUserError';
  }
}

/** Thrown by EngineService.resumeSession when the requested session file
 *  fails confinement or cannot be reopened. The message is FIXED by design:
 *  the requested path is unvalidated network input and is never echoed
 *  (no filesystem oracle). Routes map it to 404 'session not found'. */
export class SessionResumeRejectedError extends Error {
  constructor(message = 'session not found') {
    super(message);
    this.name = 'SessionResumeRejectedError';
  }
}

/** Provider control-plane error carrying the HTTP status the route answers
 *  verbatim (400 validation, 409 conflict, 500 config write failure). The
 *  message is ALWAYS engine-composed and NEVER contains a submitted key or
 *  file content, so routes may pass it through unchanged. */
export class ProviderOpError extends Error {
  readonly status: 400 | 409 | 500;
  constructor(status: 400 | 409 | 500, message: string) {
    super(message);
    this.name = 'ProviderOpError';
    this.status = status;
  }
}

/** Detect whether we are running under the Bun runtime (the omp SDK requires it). */
export function isBunRuntime(): boolean {
  return typeof process.versions?.bun === 'string';
}

/** Compact JSON rendering of tool args (one line, truncated for the console). */
function stringifyArgs(args: unknown): string {
  if (args === undefined) return '';
  if (typeof args === 'string') return args;
  const s = safeStringify(args);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

/** JSON.stringify that never throws (BigInt, cycles, etc.). */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}
/** Extract readable text from a message content: string or text blocks. */
function extractContentText(content: unknown, includeToolJson: boolean): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b?.type === 'text' && typeof b?.text === 'string') parts.push(b.text);
      else if (includeToolJson) parts.push(safeStringify(block));
    }
    return parts.join('\n');
  }
  return '';
}

/** Build the truthful error text for an errored assistant message_end. omp
 *  records the underlying provider error on `errorMessage` (e.g. a 404 for a
 *  model the server does not serve) and the stop category on
 *  `stopDetails.type`. Prefer them over the generic fallback so a failed turn
 *  is never misdiagnosed as a model-availability problem. */
function describeOmpTurnError(message: Record<string, unknown>): string {
  const raw = typeof message?.errorMessage === 'string' ? message.errorMessage.trim() : '';
  if (raw) return raw;
  const details = (message?.stopDetails as Record<string, unknown> | undefined) ?? {};
  const stopType = typeof details?.type === 'string' ? details.type : '';
  // Provider shapes differ: Anthropic classifies on `explanation`, others on
  // `reason`. Accept either through the loose record cast.
  const explanation =
    typeof details?.explanation === 'string'
      ? details.explanation.trim()
      : typeof details?.reason === 'string'
        ? details.reason.trim()
        : '';
  if (stopType && explanation) return `Turn ended with error (${stopType}): ${explanation}`;
  if (stopType) return `Turn ended with error (${stopType})`;
  return 'Model returned no output — the model may not be available on the configured server. Try a different model.';
}

/** Compose the actionable error for a catalog model that the provider server
 *  does not actually serve (e.g. an alias in models.yml the local vLLM never
 *  hosts). Returns null when the id appears in the served list. */
export function describeUnservedModel(opts: {
  provider: string;
  modelId: string;
  baseUrl: string;
  servedIds: string[];
}): string | null {
  if (opts.servedIds.includes(opts.modelId)) return null;
  const served =
    opts.servedIds.length > 0
      ? opts.servedIds.map((id) => `\`${id}\``).join(', ')
      : '(none listed)';
  return `Model ${opts.provider}/${opts.modelId} is not served by the provider at ${opts.baseUrl}. Served models: ${served}.`;
}

interface OmpModelLike {
  id: string;
  provider: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  baseUrl?: string;
  isEmbedded?: boolean;
}

/** Structural slice of omp ModelRegistry the provider control plane uses.
 *  Every member optional: the SDK surface is feature-detected, never assumed. */
interface OmpRegistryLike {
  getAll?(): OmpModelLike[];
  hasProvider?(id: string): boolean;
  getProviderBaseUrl?(id: string): unknown;
  getProviderDiscoveryState?(id: string): unknown;
  getDiscoverableProviders?(): string[];
  refresh?(strategy?: string): unknown;
  refreshProvider?(id: string, strategy?: string): unknown;
}

/** Structural slice of omp AuthStorage (source-verified: hasAuth and
 *  getCredentialOrigin are sync; set/remove/peekApiKey are async). */
interface OmpAuthStorageLike {
  hasAuth(provider: string): boolean;
  getCredentialOrigin?(provider: string): { kind?: string } | undefined;
  set(provider: string, credential: { type: 'api_key'; key: string }): Promise<unknown>;
  remove(provider: string): Promise<unknown>;
  peekApiKey?(provider: string): Promise<string | undefined>;
}

/** Where omp's AuthStorage found the credential (getCredentialOrigin kinds). */
export type ProviderAuthOrigin = 'runtime' | 'config' | 'oauth' | 'api_key' | 'env' | 'fallback';

const AUTH_ORIGINS: readonly string[] = [
  'runtime',
  'config',
  'oauth',
  'api_key',
  'env',
  'fallback',
];

/** Row of GET /api/omp/providers. Structurally identical to the facade's
 *  ProviderDto (stable GUI contract) — engine-service must not import
 *  omp-facade (the reverse edge already exists; definitions here would form
 *  the cycle madge gates), so this mirror sits on the engine side of the
 *  boundary exactly like OmpModelLike does. */
export interface EngineProviderDto {
  id: string;
  name: string;
  baseUrl?: string;
  modelCount: number;
  models: string[];
  /** Truth = authStorage.hasAuth(id) — the catalog has NO authenticated
   *  field; anything derived from model rows was the old lie. */
  authenticated: boolean;
  discoverable: boolean;
  /** models.yml owns the provider (deletable custom entry). */
  custom: boolean;
  authOrigin?: ProviderAuthOrigin;
  discoveryStatus?: string;
}

/** Result of POST /api/omp/providers/:id/verify — the model LIST itself is
 *  never returned, only its count. */
export interface ProviderVerifyResult {
  reachable: boolean;
  modelCount: number | null;
  reason?: 'no-base-url' | 'timeout' | 'network' | `http-${number}`;
}

/** Count of served models in an OpenAI-style /models payload (data[] array
 *  or a bare array). Unknown shape → null: an honest "don't know". */
function countServedModels(body: unknown): number | null {
  if (Array.isArray(body)) return body.length;
  // `in` narrowing: parsed JSON is untrusted shape, no cast-fabricated access.
  if (body !== null && typeof body === 'object' && 'data' in body && Array.isArray(body.data))
    return body.data.length;
  return null;
}

interface OmpSessionLike {
  sessionId: string;
  sessionName: string;
  model: { provider: string; modelId?: string; id?: string };
  subscribe(listener: (event: unknown) => void): () => void;
  subscribeRunState(listener: (state: 'running' | 'idle') => void): () => void;
  prompt(message: string): Promise<unknown>;
  compact(customInstructions?: string): Promise<unknown>;
  dispose(): Promise<void>;
  getSessionStats?(): {
    tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  };
  getAllToolNames?(): string[];
  getEnabledToolNames?(): string[];
  /** Journaled messages (AgentMessage[]): stable chronological order. */
  messages?: unknown[];
  /** omp's on-disk session file (AgentSession getter). Disk-backed sessions
   *  materialize it lazily — undefined until the first assistant message. */
  sessionFile?: string;
}

/** A live agent session handle exposed to the API layer. */
export class EngineSession {
  readonly id: string;
  readonly cwd: string;
  /** Creation instant (epoch ms). Every summary derives `createdAt` from this
   *  so the value is stable across reads (it used to be a fresh new Date()
   *  per summary, so the same session "changed" on every poll). */
  readonly createdAtMs = Date.now();
  /** omp.subscribe()'s unsubscribe handle (finding #6): dispose() MUST call
   *  it — the discarded handle let late emitter frames resurrect a closed
   *  session and ghost-broadcast on a dead sessionId. */
  private detachOmpListener: (() => void) | null = null;
  private omp: OmpSessionLike | null = null;
  /** omp session file captured at attach — keeps the identity readable
   *  after dispose() clears the omp handle. See the live sessionFile getter. */
  private attachedSessionFile?: string;
  private onEvent: (ev: SessionTurnEvent) => void;
  status: 'idle' | 'running' | 'error' | 'closed' = 'idle';
  private count = 0;
  /** Last assistant text seen (updated on message_end) for loop summaries. */
  lastAssistantText = '';
  /** True while the current turn has produced any assistant text. */
  private turnHadOutput = false;
  /** True while the current turn has streamed any thinking — a thinking-only
   *  reply is a model response, not a silent failure. */
  private turnHadThinking = false;
  /** True if the current turn surfaced an explicit engine error event. */
  private turnErrored = false;
  /** A turn is in flight (gate for concurrent prompts). */
  get busy(): boolean {
    return this.status === 'running';
  }

  constructor(opts: { id: string; cwd: string; onEvent: (ev: SessionTurnEvent) => void }) {
    this.id = opts.id;
    this.cwd = opts.cwd;
    this.onEvent = opts.onEvent;
  }

  /** Attach the underlying omp session (called by EngineService after creation). */
  attach(omp: OmpSessionLike): void {
    // Re-attach safety: drop any listener held from a previous handle.
    this.detachOmpListener?.();
    this.detachOmpListener = null;
    this.omp = omp;
    this.attachedSessionFile = omp.sessionFile;
    const detach = omp.subscribe((ev) => this.#onOmpEvent(ev));
    // Feature-detected: older SDK builds may return nothing from subscribe()
    // — the post-dispose guard in #onOmpEvent is the backstop either way.
    this.detachOmpListener = typeof detach === 'function' ? detach : null;
  }

  /** Absolute path of omp's on-disk session file (undefined until omp
   *  materializes it — disk-backed files appear lazily at the first
   *  assistant message). Read through the LIVE omp handle so every summary
   *  picks the path up the moment it exists; falls back to the value seen
   *  at attach once the handle is gone (disposed session). */
  get sessionFile(): string | undefined {
    return this.omp?.sessionFile ?? this.attachedSessionFile;
  }

  /** Run one turn. Resolves with the turn's honest outcome instead of void:
   *  'busy' when the busy guard rejects the prompt, 'error' when the turn
   *  errored (explicit engine error or a zero-output turn), 'ok' otherwise.
   *  Callers like LoopRunner must NOT treat a failed turn as a good round —
   *  the events themselves stay unchanged (session_error rides both paths). */
  async prompt(message: string): Promise<'ok' | 'busy' | 'error'> {
    const omp = this.#require();
    if (this.status === 'running') {
      this.onEvent({
        kind: 'session_error',
        message: 'Session is busy — the previous turn is still running',
      });
      return 'busy';
    }
    this.status = 'running';
    this.turnHadOutput = false;
    this.turnHadThinking = false;
    this.turnErrored = false;
    try {
      await omp.prompt(message);
      // An explicit turn failure already surfaced its session_error event
      // (#onOmpEvent) — still report the turn as failed to the caller.
      if (this.turnErrored) return 'error';
      // A "clean" turn can still produce zero assistant output when the model
      // is not actually served by the configured provider — omp resolves it
      // without an error event. Never present that as a successful answer.
      // Reached only when omp surfaced no error detail, so stay factual.
      // A turn that streamed thinking but no text is a model response, not a
      // silent failure — only a fully empty, error-free turn is an error.
      if (!this.turnHadOutput && !this.turnHadThinking) {
        this.status = 'error';
        this.onEvent({
          kind: 'session_error',
          message: this.annotate(
            'Model returned no output — the turn ended without assistant text and omp reported no error. Try a different model.',
          ),
        });
        return 'error';
      }
      return 'ok';
    } finally {
      if (this.status === 'running') this.status = 'idle';
    }
  }

  /** Surface an out-of-band prompt failure: the fire-and-forget route chain
   *  cannot await prompt(), so a rejection there would escape as an
   *  unhandledRejection. This mirrors the in-turn session_error path — marks
   *  the session failed and broadcasts the cause on the same channel the
   *  engine uses for prompt errors. Never throws. */
  notifyPromptFailure(cause: string): void {
    if (this.status !== 'closed') this.status = 'error';
    this.onEvent({ kind: 'session_error', message: this.annotate(`Prompt failed: ${cause}`) });
  }

  /** Compact the session context. Resolves TRUE only when compaction was
   *  actually initiated on omp; FALSE when the busy guard no-oped the call
   *  (a turn started between the route's pre-check and here). The route
   *  layer maps false → 409; the session_error event still rides the busy
   *  branch for WS watchers. */
  async compact(customInstructions?: string): Promise<boolean> {
    const omp = this.#require();
    // Mirror prompt's busy guard: compacting while a turn is in flight races
    // the model's own context management — refuse loudly instead.
    if (this.status === 'running') {
      this.onEvent({
        kind: 'session_error',
        message: 'Session is busy — cannot compact while a turn is running',
      });
      return false;
    }
    await omp.compact(customInstructions);
    return true;
  }

  async dispose(): Promise<void> {
    const omp = this.omp;
    const detach = this.detachOmpListener;
    this.detachOmpListener = null;
    this.omp = null;
    this.status = 'closed';
    // Detach the omp listener BEFORE disposing the handle: without it,
    // in-flight emitter frames re-entered #onOmpEvent on a session the map
    // no longer held — status resurrected 'closed' → active and every such
    // event ghost-broadcast on a dead sessionId.
    if (detach) {
      try {
        detach();
      } catch {
        /* emitter already torn down: nothing left to detach */
      }
    }
    if (omp) await omp.dispose();
  }

  get model(): { provider: string; modelId: string } {
    const omp = this.omp;
    const m = omp?.model ?? { provider: '', id: '' };
    return {
      provider: m.provider ?? '',
      modelId: (m.modelId ?? m.id ?? '') as string,
    };
  }

  /** Tag a session error with the model that produced the turn, so the GUI
   *  can see exactly which catalog entry failed without hunting for it. */
  private annotate(text: string): string {
    const m = this.model;
    if (!m.modelId) return text;
    return `${text} — model: ${m.provider}/${m.modelId}`;
  }
  /**
   * Reconstruct a rich transcript from the session's message journal.
   * Returns the same entry shape the realtime frames use, so a GUI can replay
   * an already-run session (e.g. loop inspection) before live frames arrive.
   */
  listTranscript(): SessionTranscriptEntry[] {
    const omp = this.omp;
    const messages = omp?.messages;
    if (!Array.isArray(messages)) return [];
    const out: SessionTranscriptEntry[] = [];
    for (const raw of messages) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const role = m?.role;
      const content = m?.content;
      if (role === 'user') {
        out.push({ kind: 'user', text: extractContentText(content, false) });
      } else if (role === 'assistant') {
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            const btype = b?.type;
            if (btype === 'thinking') {
              out.push({ kind: 'thinking', text: String(b?.thinking ?? b?.text ?? '') });
            } else if (btype === 'text') {
              out.push({ kind: 'assistant', text: String(b?.text ?? '') });
            } else if (btype === 'toolCall' || btype === 'toolCallBlock') {
              out.push({
                kind: 'tool',
                name: String(b?.toolName ?? b?.name ?? 'tool'),
                args: safeStringify(b?.args),
              });
            }
          }
        } else if (typeof content === 'string') {
          out.push({ kind: 'assistant', text: content });
        }
      } else if (role === 'toolResult') {
        out.push({
          kind: 'tool',
          name: String(m?.toolName ?? 'tool'),
          result: extractContentText(content, true),
          isError: m?.isError === true,
        });
      }
    }
    return out;
  }

  get messageCount(): number {
    return this.count;
  }

  /**
   * Session totals (message/token counts, context usage) surfaced to the GUI
   * status line, mirroring what omp prints at the bottom of its TUI. Returns
   * null when the engine session isn't attached or stats aren't available.
   */
  stats(): null | {
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
  } {
    const omp = this.omp;
    if (!omp) return null;
    try {
      const s = omp.getSessionStats?.() as
        | {
            userMessages?: number;
            assistantMessages?: number;
            toolCalls?: number;
            totalMessages?: number;
            tokens?: {
              input?: number;
              output?: number;
              reasoning?: number;
              cacheRead?: number;
              cacheWrite?: number;
              total?: number;
            };
            cost?: number;
            contextUsage?: { tokens?: number; contextWindow?: number; percent?: number };
          }
        | undefined;
      if (!s) return null;
      const tok = s.tokens ?? {};
      return {
        messages: s.totalMessages ?? 0,
        toolCalls: s.toolCalls ?? 0,
        tokens: {
          input: tok.input ?? 0,
          output: tok.output ?? 0,
          reasoning: tok.reasoning ?? 0,
          cacheRead: tok.cacheRead ?? 0,
          cacheWrite: tok.cacheWrite ?? 0,
          total: tok.total ?? 0,
        },
        cost: s.cost ?? 0,
        context: s.contextUsage
          ? {
              tokens: s.contextUsage.tokens ?? 0,
              contextWindow: s.contextUsage.contextWindow ?? 0,
              percent: s.contextUsage.percent ?? 0,
            }
          : undefined,
      };
    } catch {
      return null;
    }
  }

  #require(): OmpSessionLike {
    if (!this.omp) throw new EngineUnavailableError('Session is not attached');
    return this.omp;
  }

  /** Map raw AgentSessionEvent frames to our normalized wire events. */
  #onOmpEvent(ev: unknown): void {
    const e = ev as Record<string, unknown>;
    const type = e?.type as string | undefined;
    if (!type) return;
    // Post-dispose backstop (finding #6): dispose() detaches the listener,
    // but a frame already queued inside the emitter's dispatch can still
    // arrive — a closed session must never flip back to active nor emit.
    if (this.status === 'closed') return;
    switch (type) {
      case 'agent_start':
        this.status = 'running';
        this.onEvent({ kind: 'turn_start', turn: 0 });
        break;
      case 'message_start': {
        const role = (e?.message as Record<string, unknown>)?.role ?? 'system';
        this.onEvent({
          kind: 'message_start',
          role: role as 'user' | 'assistant' | 'system',
          turn: 0,
        });
        break;
      }
      case 'message_update': {
        const ame = (e?.assistantMessageEvent ?? {}) as Record<string, unknown>;
        const delta = ame?.delta;
        // omp streams separate thinking_delta vs text_delta blocks; the block
        // kind lives in `.type`, not `.block`.
        const kind = ame?.type === 'thinking_delta' ? 'thinking' : 'assistant';
        if (typeof delta === 'string') {
          if (kind === 'assistant') this.turnHadOutput = true;
          else if (kind === 'thinking') this.turnHadThinking = true;
          this.onEvent({ kind: 'message_update', role: kind, delta, turn: 0 });
        }
        break;
      }
      case 'tool_execution_start': {
        const args = e?.args;
        this.onEvent({
          kind: 'tool_call',
          name: String(e?.toolName ?? 'unknown'),
          args: stringifyArgs(args),
          turn: 0,
        });
        break;
      }
      case 'tool_execution_update': {
        // Optional live partial output while a tool runs.
        const partial = e?.partialResult;
        if (partial !== undefined) {
          this.onEvent({
            kind: 'tool_result',
            name: String(e?.toolName ?? 'unknown'),
            isError: false,
            content: typeof partial === 'string' ? partial : safeStringify(partial),
            turn: 0,
          });
        }
        break;
      }
      case 'tool_execution_end': {
        const result = e?.result;
        this.onEvent({
          kind: 'tool_result',
          name: String(e?.toolName ?? 'unknown'),
          isError: e?.isError === true,
          content: typeof result === 'string' ? result : safeStringify(result),
          turn: 0,
        });
        break;
      }
      case 'message_end': {
        const m = (e?.message ?? {}) as Record<string, unknown>;
        if (m?.role === 'user' || m?.role === 'assistant') this.count++;
        const content = m?.content as Array<Record<string, unknown>> | undefined;
        const text = Array.isArray(content)
          ? content
              .filter((c) => c?.type === 'text')
              .map((c) => String(c.text ?? ''))
              .join('')
          : '';
        if (m?.role === 'assistant') {
          const stopReason = (m?.stopReason as string) ?? '';
          if (text) this.turnHadOutput = true;
          if (!text && stopReason === 'error') {
            // omp ends an errored turn with an empty assistant message whose
            // stopReason is "error" (no separate error event). The real cause
            // lives on errorMessage (e.g. a provider 404 for a model the
            // server does not serve); surface it verbatim instead of guessing.
            this.status = 'error';
            this.turnErrored = true;
            this.onEvent({
              kind: 'session_error',
              message: this.annotate(describeOmpTurnError(m)),
            });
          }
          this.lastAssistantText = text;
          this.onEvent({
            kind: 'message_end',
            role: 'assistant',
            text,
            stopReason: (m?.stopReason as string) ?? undefined,
            turn: 0,
          });
        }
        break;
      }
      case 'agent_end':
        this.status = 'idle';
        this.onEvent({ kind: 'agent_end', isTerminal: e?.isTerminal !== false });
        break;
      case 'error':
        this.turnErrored = true;
        this.status = 'error';
        this.onEvent({
          kind: 'session_error',
          message: String((e?.error as string) ?? 'engine error'),
        });
        break;
    }
  }
}

export interface EngineServiceOptions {
  /** Working directory sessions default to when none is provided. */
  defaultCwd?: string;
  /** Enable even under plain Node (used to force exercises in tests that mock the SDK). */
  force?: boolean;
  /** Hard cap on concurrently live sessions. Defaults to the
   *  MAX_LIVE_SESSIONS env var, then 64. */
  maxLiveSessions?: number;
}

/** One provider's group in the /api/models payload. `total` is the FULL
 *  pre-slice count and `truncated` says whether rows were dropped, so a GUI
 *  can never render a capped group as the complete catalog (a local ollama
 *  catalog can exceed the 200-row slice). */
export interface ModelCatalogGroup extends ProviderModelGroup {
  total: number;
  truncated: boolean;
}

/** Per-provider row cap for the /api/models payload. */
const MODEL_GROUP_CAP = 200;
/** Default live-session cap when MAX_LIVE_SESSIONS is unset or invalid. */
const DEFAULT_MAX_LIVE_SESSIONS = 64;

/** Resolve the live-session cap: constructor override → MAX_LIVE_SESSIONS → 64. */
function parseMaxLiveSessions(value: number | string | undefined): number {
  const n = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_LIVE_SESSIONS;
}

/**
 * Owns the omp ModelRegistry + auth storage, creates sessions, and indexes
 * the current model catalog for the GUI.
 */
export class EngineService {
  private opts: EngineServiceOptions;
  private available = false;
  private loadError: string | null = null;
  private registry: unknown = null; // ModelRegistry
  private authStorage: unknown = null;
  private sessions = new Map<string, EngineSession>();
  private nextSessionId = 1;
  private started = false;
  /** In-flight startup attempt shared by concurrent callers; cleared when it
   *  settles so a FAILED attempt stays retryable (see start()). */
  private starting: Promise<void> | null = null;
  /** Live-session cap (constructor override → MAX_LIVE_SESSIONS → 64). */
  private maxLiveSessions: number;
  /** One-shot latch: warn only the first time the cap meets an all-busy set. */
  private capWarnedAllBusy = false;
  /** Lazily built models.yml store (production codecs, Bun-gated call sites).
   *  PLAIN private fields (not #private) on purpose: the Node test suite
   *  injects a tmp-path store / fake fetch through a cast to exercise these
   *  paths without the Bun runtime. */
  private modelsStore: ModelsYamlStore | null = null;
  /** In-flight #requireModelsStore build. Shared so concurrent first-use
   *  callers can never build TWO store instances — the CRUD read-modify-write
   *  mutex is per-instance, a second instance would write models.yml outside
   *  the lock held by the first. */
  private modelsStoreInit: Promise<ModelsYamlStore> | null = null;
  /** SDK ModelsConfigFile handle (invalidate() after writes) when reachable. */
  private modelsConfigFile: unknown = null;
  /** HTTP probe seam for verifyProvider (tests inject a deterministic fetch). */
  private fetchImpl: typeof fetch = ((...args: Parameters<typeof fetch>) =>
    globalThis.fetch(...args)) as typeof fetch;

  constructor(opts: EngineServiceOptions = {}) {
    this.opts = opts;
    // Availability is provisional until start() performs the real dynamic
    // import: bun's createRequire() does not go through the ESM exports map,
    // so probing with require.resolve() is unreliable here.
    this.available = isBunRuntime() || opts.force === true;
    this.maxLiveSessions = parseMaxLiveSessions(
      opts.maxLiveSessions ?? process.env.MAX_LIVE_SESSIONS,
    );
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get availabilityError(): string | null {
    return this.loadError;
  }

  /** Startup: realize the model registry snapshot. Idempotent once warm;
   *  concurrent callers share one attempt. The success latch is ONE-WAY:
   *  only a fully successful init sets `started`. A transient auth-storage
   *  discovery or registry refresh failure records availabilityError but
   *  leaves the service RETRYABLE — the next start() (every engine route
   *  calls it) re-attempts. Pre-fix, `started` was consumed before the
   *  attempt and any single refresh flake 501'd every engine route for the
   *  process lifetime. Only #importSdk's SDK-load failure (which latches
   *  available=false itself) is treated as permanent. Meanwhile every
   *  registry-backed route degrades via the null-registry
   *  EngineUnavailableError (routes → 501). */
  async start(): Promise<void> {
    if (this.started) return;
    if (this.starting) return this.starting;
    if (!this.available) return;
    const attempt = (async (): Promise<void> => {
      try {
        const { ModelRegistry, discoverAuthStorage } = await this.#importSdk();
        const auth = await discoverAuthStorage();
        const registry = new ModelRegistry(auth);
        await registry.refresh();
        this.authStorage = auth;
        this.registry = registry;
        this.started = true;
      } catch (err) {
        // #importSdk already latched available=false for the permanent case.
        // Everything else (auth discovery, refresh network flake) is
        // transient: record the cause, keep `started` false, retry later.
        this.loadError = err instanceof Error ? err.message : String(err);
      }
    })();
    this.starting = attempt;
    // attempt never rejects (the catch above absorbs everything), so this
    // cleanup always runs and a failed attempt leaves nothing latched.
    void attempt.then(() => {
      if (this.starting === attempt) this.starting = null;
    });
    await attempt;
  }

  /** Dynamic import of the Bun-only SDK (never at module scope). */
  async #importSdk(): Promise<typeof import('@oh-my-pi/pi-coding-agent')> {
    try {
      return await import('@oh-my-pi/pi-coding-agent');
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      this.available = false;
      throw new EngineUnavailableError(`Failed to load omp SDK: ${this.loadError}`);
    }
  }

  async listModels(): Promise<ModelCatalogGroup[]> {
    await this.start();
    if (!this.registry) throw new EngineUnavailableError();
    const registry = this.registry as {
      getAvailable(): OmpModelLike[];
    };
    try {
      const all = registry.getAvailable();
      const byProvider = new Map<string, ModelRecord[]>();
      for (const m of all) {
        if (!m.provider) continue;
        const rec: ModelRecord = {
          id: m.id,
          name: m.name ?? m.id,
          provider: m.provider,
          contextWindow: m.contextWindow ?? 0,
          maxTokens: m.maxTokens ?? 0,
          baseUrl: m.baseUrl,
          isEmbedded: m.isEmbedded ?? false,
        };
        const group = byProvider.get(m.provider);
        if (group) group.push(rec);
        else byProvider.set(m.provider, [rec]);
      }
      return Array.from(byProvider.entries()).map(([provider, models]) => ({
        provider,
        models: models.slice(0, MODEL_GROUP_CAP),
        total: models.length,
        truncated: models.length > MODEL_GROUP_CAP,
      }));
    } catch (err) {
      throw new EngineUnavailableError(
        `Failed to list models: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Resolve a model id (e.g. `local-server/deepseek-ai/...` or `provider/id`)
   * to the registry's Model object, which is what createAgentSession requires
   * (a bare {provider, modelId} shape fails silently at prompt time).
   */
  async resolveModel(selector: { provider: string; modelId: string }) {
    await this.start();
    if (!this.registry) throw new EngineUnavailableError();
    const registry = this.registry as {
      find(provider: string, id: string): OmpModelLike | undefined;
    };
    const model = registry.find(selector.provider, selector.modelId);
    if (!model)
      throw new EngineUserError(`Model not found: ${selector.provider}/${selector.modelId}`);
    return model;
  }

  /**
   * Best-effort check that a resolved catalog model is actually served by its
   * provider before a session is created. A catalog entry the server does not
   * host (e.g. a local-server alias missing the served revision) otherwise
   * fails its first turn with a confusing "no output" error. Only a POSITIVE
   * absence blocks — an unreachable or unparseable model list lets creation
   * proceed and the turn surfaces the real error instead.
   */
  async #verifyModelServed(model: OmpModelLike): Promise<void> {
    const baseUrl =
      typeof model.baseUrl === 'string' && model.baseUrl ? model.baseUrl.replace(/\/+$/, '') : '';
    if (!baseUrl) return;
    try {
      const auth = this.authStorage as {
        getApiKey?(provider: string): Promise<string | undefined>;
      } | null;
      const apiKey = (await auth?.getApiKey?.(model.provider)) ?? undefined;
      const res = await fetch(`${baseUrl}/models`, {
        headers: {
          accept: 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return; // endpoint absent or auth-gated — cannot verify
      const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
      const servedIds = Array.isArray(body?.data)
        ? body.data
            .map((d) => (typeof d?.id === 'string' ? d.id : null))
            .filter((id): id is string => id !== null)
        : [];
      if (servedIds.length === 0) return; // unrecognized shape — cannot verify
      const problem = describeUnservedModel({
        provider: model.provider,
        modelId: model.id,
        baseUrl,
        servedIds,
      });
      if (problem) throw new EngineUserError(problem);
    } catch (err) {
      if (err instanceof EngineUserError) throw err;
      // Probe unreachable on this provider — let the turn surface the real error.
    }
  }

  /** Create a new agent session, attached to the omp engine. */
  async createSession(opts: {
    cwd: string;
    model: { provider: string; modelId: string };
  }): Promise<EngineSession> {
    await this.start();
    if (!this.registry || !this.authStorage) throw new EngineUnavailableError();
    const sdk = await this.#importSdk();
    const model = await this.resolveModel(opts.model);
    // Refuse to create a session on a catalog model the provider server does
    // not actually serve — omp would fail the first turn with a confusing
    // "no output" instead of naming the wrong model id.
    await this.#verifyModelServed(model);

    const id = `ses_${this.nextSessionId++}`;
    const session = new EngineSession({
      id,
      cwd: opts.cwd,
      onEvent: (ev) => this.emit(session, ev),
    });
    const { createAgentSession, SessionManager } = sdk;
    const created = await createAgentSession({
      // Disk-backed on purpose (was SessionManager.inMemory — those sessions
      // vanished with the process). create(cwd) persists the journal under
      // omp's session roots (the file itself materializes lazily at the
      // first assistant message), so GUI sessions are durable and reopenable
      // via resumeSession. The cwd is threaded in too — tools (bash/read/
      // edit) take their working directory from sessionManager.getCwd(), so
      // without it they run in the process cwd.
      sessionManager: SessionManager.create(opts.cwd),
      authStorage: this.authStorage,
      modelRegistry: this.registry,
      cwd: opts.cwd,
      model,
      enableMCP: false,
      enableLsp: false,
    } as never);
    session.attach((created as { session: OmpSessionLike }).session);
    // Cap enforcement runs immediately before the insert: freshest eviction
    // decision, smallest race window, no wasted eviction on failed creation.
    await this.#enforceSessionCap();
    this.sessions.set(id, session);
    return session;
  }

  /**
   * Resume a persisted agent session from its on-disk journal (durable GUI
   *  sessions). Structurally identical to createSession (served-model
   *  preflight, cap enforcement, event wiring, live-map registration) — the
   *  only difference is the SessionManager: the confined file is REOPENED
   *  instead of a fresh one created.
   *
   *  The path is network input: it is CONFINED first (defaultSessionRoots +
   *  confineSessionPath — the same single-source guard OmpFacade transcript
   *  reads use) before anything, fs or SDK, ever touches it. Every rejection
   *  (outside roots, wrong extension, missing, symlink escape, unopenable
   *  journal) throws SessionResumeRejectedError with a fixed message — never
   *  an echo of the requested path, never an fs error detail.
   */
  async resumeSession(opts: {
    cwd: string;
    model: { provider: string; modelId: string };
    sessionFile: string;
  }): Promise<{ session: EngineSession; warning?: string }> {
    await this.start();
    if (!this.registry || !this.authStorage) throw new EngineUnavailableError();
    const sdk = await this.#importSdk();
    // Confinement FIRST: the raw path never reaches fs, the SDK, or a log.
    const confined = confineSessionPath(opts.sessionFile, defaultSessionRoots(sdk.SessionManager));
    if (!confined.ok) throw new SessionResumeRejectedError();
    const model = await this.resolveModel(opts.model);
    // Same preflight as createSession — a resumed turn on an unserved catalog
    // model would fail its first turn with a confusing "no output".
    await this.#verifyModelServed(model);

    const { createAgentSession, SessionManager } = sdk;
    const open = (
      SessionManager as unknown as { open?(filePath: string): Promise<unknown> } | undefined
    )?.open;
    if (typeof open !== 'function') {
      throw new EngineUnavailableError(
        'Agent engine cannot resume sessions: SessionManager.open is unavailable',
      );
    }
    let sessionManager: unknown;
    try {
      // Only confined.path (realpath, proven inside a session root) reaches
      // the SDK here.
      sessionManager = await open.call(SessionManager, confined.path);
    } catch (err) {
      // A confined-but-unopenable journal is still "not a restorable
      // session" to the caller. The real cause is logged server-side only —
      // SDK/fs messages can carry absolute paths.
      console.error(
        `[EngineService] session open failed for a confined journal: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new SessionResumeRejectedError();
    }

    const id = `ses_${this.nextSessionId++}`;
    const session = new EngineSession({
      id,
      cwd: opts.cwd,
      onEvent: (ev) => this.emit(session, ev),
    });
    const created = await createAgentSession({
      // Same option shape as createSession — only the sessionManager differs
      // (reopened journal vs fresh disk-backed one).
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.registry,
      cwd: opts.cwd,
      model,
      enableMCP: false,
      enableLsp: false,
    } as never);
    const createdResult = created as {
      session: OmpSessionLike;
      modelFallbackMessage?: unknown;
    };
    session.attach(createdResult.session);
    // The SDK reports a restored-model downgrade here (e.g. the journal's
    // model is no longer in the catalog) — surface it verbatim so the GUI
    // can tell the user which model the resumed session actually runs on.
    const warning =
      typeof createdResult.modelFallbackMessage === 'string' && createdResult.modelFallbackMessage
        ? createdResult.modelFallbackMessage
        : undefined;
    // Cap enforcement runs immediately before the insert — exactly like
    // createSession (freshest eviction decision, no wasted eviction).
    await this.#enforceSessionCap();
    this.sessions.set(id, session);
    return { session, warning };
  }

  getSession(id: string): EngineSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): EngineSession[] {
    return Array.from(this.sessions.values());
  }

  async disposeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    await session.dispose();
    this.sessions.delete(id);
    return true;
  }

  /**
   * Enforce the live-session cap before a new session is inserted: dispose the
   * oldest (insertion-order) NON-busy session until there is room. A busy
   * session is never force-disposed; when every live session is busy creation
   * still proceeds with a one-time loud warning — a temporary overshoot beats
   * failing a legitimate request.
   */
  async #enforceSessionCap(): Promise<void> {
    while (this.sessions.size >= this.maxLiveSessions) {
      let victim: EngineSession | undefined;
      for (const candidate of this.sessions.values()) {
        if (!candidate.busy) {
          victim = candidate;
          break;
        }
      }
      if (!victim) {
        if (!this.capWarnedAllBusy) {
          this.capWarnedAllBusy = true;
          console.warn(
            `[EngineService] MAX_LIVE_SESSIONS cap (${this.maxLiveSessions}) reached with every session busy — creating anyway`,
          );
        }
        return;
      }
      try {
        await this.disposeSession(victim.id);
      } catch (err) {
        console.error(
          `[EngineService] cap eviction dispose failed for ${victim.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // disposeSession keeps the entry when dispose() threw — drop it here so
      // the eviction loop always makes progress.
      this.sessions.delete(victim.id);
    }
  }

  /** Dispose every live session and clear the index (shutdown path).
   *  Resilient to individual failures — one bad session never blocks the
   *  rest, and this method never throws. */
  async disposeAll(): Promise<void> {
    const live = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const session of live) {
      try {
        await session.dispose();
      } catch (err) {
        console.error(
          `[EngineService] disposeAll failed for ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Broadcast an event from a session to whoever subscribed (WS hub installs this). */
  onBroadcast: ((sessionId: string, ev: SessionTurnEvent) => void) | null = null;

  private emit(session: EngineSession, ev: SessionTurnEvent): void {
    if (this.onBroadcast) this.onBroadcast(session.id, ev);
  }

  /** Build a GUI-facing summary for a session. */
  toSummary(session: EngineSession): SessionSummary {
    const model = session.model;
    const createdAt = new Date(session.createdAtMs).toISOString();
    return {
      id: session.id,
      name: session.id,
      cwd: session.cwd,
      model,
      status: session.status,
      messageCount: session.messageCount,
      createdAt,
      /** omp session file once materialized — the GUI echoes it back as
       *  resumePath to reopen this session after a backend restart. */
      sessionFile: session.sessionFile,
    };
  }

  /** Rich transcript from a live session's journal (loop/session inspection). */
  transcriptOf(id: string): SessionTranscriptEntry[] | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return session.listTranscript();
  }

  /* ─── Provider control plane (keys, models.yml, verification) ──────── */

  /** Warm registry + authStorage or EngineUnavailableError (routes → 501). */
  async #requireProviderWarm(): Promise<{
    registry: OmpRegistryLike;
    auth: OmpAuthStorageLike;
  }> {
    await this.start();
    if (!this.registry || !this.authStorage) throw new EngineUnavailableError();
    return {
      registry: this.registry as OmpRegistryLike,
      auth: this.authStorage as OmpAuthStorageLike,
    };
  }

  /** Provider catalog from the LIVE instances: auth truth is
   *  authStorage.hasAuth(id), custom truth is the models.yml providers map,
   *  discoveryStatus comes from the registry's per-provider state. */
  async listProviderDtos(): Promise<EngineProviderDto[]> {
    const { registry, auth } = await this.#requireProviderWarm();
    try {
      const customNames = new Set(await this.#customProviderNames());
      let discoverable: string[] = [];
      try {
        discoverable = registry.getDiscoverableProviders?.() ?? [];
      } catch {
        /* discovery is best-effort */
      }
      const discoverableSet = new Set(discoverable);
      const row = (pid: string, baseUrl?: string): EngineProviderDto => {
        const dto: EngineProviderDto = {
          id: pid,
          name: pid,
          baseUrl: baseUrl || undefined,
          modelCount: 0,
          models: [],
          authenticated: false,
          discoverable: discoverableSet.has(pid),
          custom: customNames.has(pid),
        };
        try {
          dto.authenticated = auth.hasAuth(pid) === true;
        } catch {
          /* auth-store quirk on one row never sinks the catalog */
        }
        try {
          const origin = auth.getCredentialOrigin?.(pid)?.kind;
          if (origin !== undefined && AUTH_ORIGINS.includes(origin))
            dto.authOrigin = origin as ProviderAuthOrigin;
        } catch {
          /* older SDK: no origin info */
        }
        try {
          // getProviderDiscoveryState returns a STATE OBJECT ({provider,
          // status, ...}), not a string — the string form lives on .status.
          const state = registry.getProviderDiscoveryState?.(pid);
          if (
            state !== null &&
            typeof state === 'object' &&
            'status' in state &&
            typeof state.status === 'string'
          )
            dto.discoveryStatus = state.status;
        } catch {
          /* older SDK: no discovery state */
        }
        return dto;
      };
      const byProvider = new Map<string, EngineProviderDto>();
      for (const m of registry.getAll?.() ?? []) {
        const pid = m?.provider;
        if (!pid) continue;
        let rec = byProvider.get(pid);
        if (!rec) {
          rec = row(pid, m?.baseUrl);
          byProvider.set(pid, rec);
        }
        rec.modelCount++;
        if (rec.models.length < 20 && m.id) rec.models.push(m.id);
      }
      // Discoverable runtime providers with no static models yet still get a
      // row (same shape as the facade's per-call path).
      for (const pid of discoverableSet) {
        if (!byProvider.has(pid)) byProvider.set(pid, row(pid));
      }
      return Array.from(byProvider.values());
    } catch (err) {
      if (err instanceof EngineUnavailableError) throw err;
      throw new EngineUnavailableError(
        `Failed to list providers: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Store a provider API key in the LIVE omp AuthStorage (in-memory
   *  credential cache stays correct — never a fresh discoverAuthStorage()). */
  async setProviderApiKey(provider: string, apiKey: string): Promise<void> {
    const { registry, auth } = await this.#requireProviderWarm();
    if (!(await this.#isKnownProvider(provider)))
      throw new ProviderOpError(400, 'unknown provider');
    try {
      await auth.set(provider, { type: 'api_key', key: apiKey });
    } catch {
      // Fixed text ONLY: SDK error strings are not trusted to be free of the
      // submitted key, and the key must never reach console output either.
      console.error(`[EngineService] authStorage.set failed for provider ${provider}`);
      throw new ProviderOpError(500, 'provider key write failed');
    }
    this.#refreshProviderQuietly(registry, provider);
  }

  /** Drop a stored key. Returns the POST-removal auth truth (hasAuth). */
  async removeProviderApiKey(provider: string): Promise<boolean> {
    const { registry, auth } = await this.#requireProviderWarm();
    try {
      await auth.remove(provider);
    } catch {
      console.error(`[EngineService] authStorage.remove failed for provider ${provider}`);
      throw new ProviderOpError(500, 'provider key removal failed');
    }
    this.#refreshProviderQuietly(registry, provider);
    try {
      return auth.hasAuth(provider) === true;
    } catch {
      return false;
    }
  }

  /** Add a custom provider to models.yml. Registry-known (bundled) names
   *  409 BEFORE touching the file; shape validation and the ≤500 cap are the
   *  pure merge. Returns the written name (never the inline key). */
  async createCustomProvider(input: CreateProviderInput): Promise<string> {
    const { registry } = await this.#requireProviderWarm();
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!PROVIDER_NAME_PATTERN.test(name))
      throw new ProviderOpError(400, 'provider.name must match ^[a-z0-9][a-z0-9_-]{0,63}$');
    let known = false;
    try {
      known = registry.hasProvider?.(name) === true;
    } catch {
      /* feature-detected: the models.yml duplicate check still guards */
    }
    if (known) throw new ProviderOpError(409, 'provider already exists');
    const store = await this.#requireModelsStore();
    // The ENTIRE load → merge → save → refresh cycle runs under the store's
    // read-modify-write mutex: concurrent CRUD callers must never build on
    // the same stale base config (pre-fix the later save silently dropped
    // the earlier writer's change).
    return store.withLock(async () => {
      const loaded = await store.load();
      if (!loaded.ok) throw new ProviderOpError(loaded.status, loaded.error);
      const merged = mergeNewProvider(loaded.value, { ...input, name });
      if (!merged.ok) throw new ProviderOpError(merged.status, merged.error);
      await this.#writeModelsConfig(store, merged.value.config);
      await this.#refreshAfterConfigWrite(registry, merged.value.name);
      return merged.value.name;
    });
  }

  /** Remove a models.yml-owned provider: entry + stored key + refresh.
   *  Anything NOT owned by models.yml is a bundled provider → 400 with the
   *  fixed 'built-in providers…' message. */
  async deleteCustomProvider(provider: string): Promise<void> {
    const { registry, auth } = await this.#requireProviderWarm();
    const store = await this.#requireModelsStore();
    // Serialized against create (same store mutex): a delete racing a create
    // must never resurrect the created entry from its stale base load.
    await store.withLock(async () => {
      const loaded = await store.load();
      if (!loaded.ok) throw new ProviderOpError(loaded.status, loaded.error);
      const merged = mergeRemovedProvider(loaded.value, provider);
      if (!merged.ok) throw new ProviderOpError(merged.status, merged.error);
      await this.#writeModelsConfig(store, merged.value);
      try {
        await auth.remove(provider);
      } catch {
        console.error(`[EngineService] authStorage.remove failed for provider ${provider}`);
      }
      await this.#refreshAfterConfigWrite(registry, provider);
    });
  }

  /** Aggregate counts for /health: distinct catalog provider count vs the
   *  authStorage.hasAuth truth. SYNC and NEVER throws — it runs on every
   *  /health poll and must degrade to honest zeros (never take the endpoint
   *  down, never spin up a second ModelRegistry). */
  providerHealthStats(): { configured: number; healthy: number } {
    if (!this.registry || !this.authStorage) return { configured: 0, healthy: 0 };
    try {
      const registry = this.registry as OmpRegistryLike;
      const auth = this.authStorage as OmpAuthStorageLike;
      const ids = new Set<string>();
      for (const m of registry.getAll?.() ?? []) {
        if (m?.provider) ids.add(m.provider);
      }
      let healthy = 0;
      for (const id of ids) {
        try {
          if (auth.hasAuth(id) === true) healthy++;
        } catch {
          /* per-provider auth quirk counts as not configured */
        }
      }
      return { configured: ids.size, healthy };
    } catch {
      return { configured: 0, healthy: 0 };
    }
  }

  /** Honest reachability probe of the provider's model endpoint. baseUrl
   *  resolves from the live registry first, then the models.yml entry; the
   *  key comes from peekApiKey (no OAuth refresh). Reports, never throws:
   *  timeout/network/HTTP failures become reason codes. The model LIST is
   *  never returned — only its count. */
  async verifyProvider(provider: string): Promise<ProviderVerifyResult> {
    const { registry, auth } = await this.#requireProviderWarm();
    let baseUrl: string | undefined;
    try {
      const b = registry.getProviderBaseUrl?.(provider);
      if (typeof b === 'string' && b) baseUrl = b;
    } catch {
      /* feature-detected */
    }
    if (!baseUrl) {
      try {
        const store = await this.#requireModelsStore();
        const loaded = await store.load();
        if (loaded.ok) {
          const b = providerEntryIn(loaded.value, provider)?.baseUrl;
          if (typeof b === 'string' && b) baseUrl = b;
        }
      } catch {
        /* models.yml unreadable → no-base-url when the registry missed too */
      }
    }
    if (!baseUrl) return { reachable: false, modelCount: null, reason: 'no-base-url' };
    let key: string | undefined;
    try {
      key = await auth.peekApiKey?.(provider);
    } catch {
      /* probe unauthenticated rather than fail */
    }
    try {
      const res = await this.fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: {
          accept: 'application/json',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return { reachable: false, modelCount: null, reason: `http-${res.status}` };
      let modelCount: number | null = null;
      try {
        modelCount = countServedModels(await res.json());
      } catch {
        /* unparseable body: reachable, count unknown */
      }
      return { reachable: true, modelCount };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      return {
        reachable: false,
        modelCount: null,
        reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      };
    }
  }

  /** Provider name known to the registry (hasProvider, falling back to a
   *  getAll scan) or present in the models.yml providers map. */
  async #isKnownProvider(provider: string): Promise<boolean> {
    const registry = this.registry as OmpRegistryLike | null;
    if (!registry) return false;
    try {
      if (registry.hasProvider?.(provider) === true) return true;
    } catch {
      /* fall through to the scan */
    }
    try {
      for (const m of registry.getAll?.() ?? []) {
        if (m?.provider === provider) return true;
      }
    } catch {
      /* fall through to models.yml */
    }
    try {
      const store = await this.#requireModelsStore();
      const loaded = await store.load();
      return loaded.ok && providerEntryIn(loaded.value, provider) !== undefined;
    } catch {
      return false;
    }
  }

  /** models.yml provider names (the custom truth). Best-effort: an unreadable
   *  config degrades to an empty set (rows render custom:false) instead of
   *  failing the whole catalog read. */
  async #customProviderNames(): Promise<string[]> {
    try {
      const store = await this.#requireModelsStore();
      const loaded = await store.load();
      return loaded.ok ? providerNamesIn(loaded.value) : [];
    } catch {
      return [];
    }
  }

  /** Build the models.yml store with PRODUCTION codecs on first use: bun's
   *  YAML parse + the SDK's own stringifyYamlConfig (omp writes its configs
   *  the same way, settings.ts precedent) at ModelsConfigFile.path(). All
   *  dynamic: the Bun-only module graph never loads under Node, and only
   *  Bun-gated provider ops ever reach here. */
  async #requireModelsStore(): Promise<ModelsYamlStore> {
    if (this.modelsStore) return this.modelsStore;
    if (this.modelsStoreInit) return this.modelsStoreInit;
    const init = (async (): Promise<ModelsYamlStore> => {
      try {
        const bunMod: unknown = await import('bun');
        const cfgMod: unknown = await import('@oh-my-pi/pi-coding-agent/config/config-file');
        const modelsMod: unknown = await import('@oh-my-pi/pi-coding-agent/config/models-config');
        const bun = bunMod as { YAML: { parse(text: string): unknown } };
        const cfg = cfgMod as { stringifyYamlConfig(value: unknown): string };
        const modelsFile = modelsMod as {
          ModelsConfigFile?: { path?(): string; invalidate?(): void };
        };
        this.modelsConfigFile = modelsFile.ModelsConfigFile ?? null;
        const path =
          modelsFile.ModelsConfigFile?.path?.() ?? join(homedir(), '.omp', 'agent', 'models.yml');
        const codecs: YamlCodecs = {
          parse: (text) => bun.YAML.parse(text),
          stringify: (value) => cfg.stringifyYamlConfig(value),
        };
        this.modelsStore = new ModelsYamlStore(path, codecs);
        return this.modelsStore;
      } catch (err) {
        throw new EngineUnavailableError(
          `models.yml store unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
    this.modelsStoreInit = init;
    // A failed build is not cached — the next call re-attempts; concurrent
    // callers of THIS call still share the same (rejected) attempt.
    void init.catch(() => {
      if (this.modelsStoreInit === init) this.modelsStoreInit = null;
    });
    return init;
  }

  /** Atomic models.yml write + invalidate the SDK's own file cache so its
   *  next read sees our write (refresh is mtime-gated). Failure is a fixed
   *  500 and a FIXED log line: fs errors carry absolute paths and YAML errors
   *  can carry values — neither is echoed, neither is logged on these
   *  credential-bearing paths. */
  async #writeModelsConfig(store: ModelsYamlStore, config: Record<string, unknown>): Promise<void> {
    try {
      await store.save(config);
    } catch {
      console.error('[EngineService] models.yml write failed');
      throw new ProviderOpError(500, 'provider config write failed');
    }
    try {
      // Held as `unknown` by design (dynamic SDK handle) — named cast, not inline.
      const configFile = this.modelsConfigFile as { invalidate?(): void } | null;
      configFile?.invalidate?.();
    } catch {
      /* best-effort: refresh() re-reads by mtime regardless */
    }
  }

  /** Re-read the catalog after a config write (registry.refresh is
   *  mtime-gated), then kick the targeted per-provider refresh. */
  async #refreshAfterConfigWrite(registry: OmpRegistryLike, provider: string): Promise<void> {
    try {
      await registry.refresh?.();
    } catch {
      console.error('[EngineService] registry refresh after provider write failed');
    }
    this.#refreshProviderQuietly(registry, provider);
  }

  /** Fire-and-forget targeted provider refresh: keeps the just-touched
   *  provider hot without blocking the response on network discovery. */
  #refreshProviderQuietly(registry: OmpRegistryLike, provider: string): void {
    try {
      void Promise.resolve(registry.refreshProvider?.(provider)).catch(() => {
        console.error(`[EngineService] provider refresh failed for ${provider}`);
      });
    } catch {
      console.error(`[EngineService] provider refresh failed for ${provider}`);
    }
  }
}

/**
 * omp session roots session-file operations are confined to: the SDK's
 * default project dir's parent (getDefaultSessionDir = join(sessionsRoot,
 * <encoded-cwd>), one level deep — honours PI_CODING_AGENT_DIR/profiles),
 * plus the standard `~/.omp/agent/sessions` fallback (same convention
 * listAgents uses for `~/.omp/agent/agents`; listAllSessions scans
 * `<agentDir>/sessions/<dir>/<file>.jsonl`, so every listed session lives
 * inside).
 *
 * SINGLE source of truth: OmpFacade.readDiskSession (transcript reads) and
 * EngineService.resumeSession (journal open) both derive roots here. The SDK
 * namespace is passed by the caller (facade and service keep their own lazy
 * Bun-only import) and feature-detected defensively — SDK shape drift
 * degrades to the standard fallback root instead of throwing.
 */
export function defaultSessionRoots(sessionManager?: unknown): string[] {
  const roots: string[] = [];
  const push = (p: string | undefined | null): void => {
    if (p && !roots.includes(p)) roots.push(p);
  };
  try {
    const manager = sessionManager as
      | { getDefaultSessionDir?(cwd: string): string }
      | null
      | undefined;
    if (typeof manager?.getDefaultSessionDir === 'function') {
      push(dirname(manager.getDefaultSessionDir(process.cwd())));
    }
  } catch {
    /* SDK shape drift → the standard fallback below still applies */
  }
  push(join(homedir(), '.omp', 'agent', 'sessions'));
  return roots;
}

/**
 * Confine a requested on-disk session path to omp's session roots.
 *
 * The GUI hands transcript reads (OmpFacade.readDiskSession) and session
 * resumes (EngineService.resumeSession) a raw path value; without this the
 * API is an arbitrary-file-read oracle whose error text echoed absolute
 * paths. Accepts ONLY a regular `.jsonl` file whose realpath (symlinks
 * resolved on BOTH sides) stays inside one of `roots`. Every failure returns
 * the same `{ ok: false }` — never an fs message, never the path — so
 * callers can map it to a fixed 404.
 */
export type ConfinedSessionPath = { ok: true; path: string } | { ok: false };

export function confineSessionPath(
  requested: string,
  roots: readonly string[],
): ConfinedSessionPath {
  const isSessionName = (p: string): boolean => p.toLowerCase().endsWith('.jsonl');
  if (!requested || !isSessionName(requested)) return { ok: false };
  let real: string;
  let stat: fs.Stats;
  try {
    real = fs.realpathSync(resolve(requested));
    // A symlink inside the root must not resolve to a non-session file.
    if (!isSessionName(real)) return { ok: false };
    stat = fs.statSync(real);
  } catch {
    return { ok: false }; // missing / unsearchable dir → same fixed answer
  }
  if (!stat.isFile()) return { ok: false };
  for (const root of roots) {
    let rootReal: string;
    try {
      rootReal = fs.realpathSync(resolve(root));
    } catch {
      continue; // root not present → nothing to confine into there
    }
    const base = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
    if (real === rootReal || real.startsWith(base)) return { ok: true, path: real };
  }
  return { ok: false };
}
