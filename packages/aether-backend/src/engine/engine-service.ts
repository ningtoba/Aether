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
import type {
  ModelRecord,
  ProviderModelGroup,
  SessionSummary,
  SessionTurnEvent,
  SessionMessage,
} from './types.js';
import type { SessionTranscriptEntry } from './types.js';

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
}

/** A live agent session handle exposed to the API layer. */
export class EngineSession {
  readonly id: string;
  readonly cwd: string;
  private omp: OmpSessionLike | null = null;
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
    this.omp = omp;
    omp.subscribe((ev) => this.#onOmpEvent(ev));
  }

  async prompt(message: string): Promise<void> {
    const omp = this.#require();
    if (this.status === 'running') {
      this.onEvent({
        kind: 'session_error',
        message: 'Session is busy — the previous turn is still running',
      });
      return;
    }
    this.status = 'running';
    this.turnHadOutput = false;
    this.turnHadThinking = false;
    this.turnErrored = false;
    try {
      await omp.prompt(message);
      // A "clean" turn can still produce zero assistant output when the model
      // is not actually served by the configured provider — omp resolves it
      // without an error event. Never present that as a successful answer.
      // Reached only when omp surfaced no error detail, so stay factual.
      // A turn that streamed thinking but no text is a model response, not a
      // silent failure — only a fully empty, error-free turn is an error.
      if (!this.turnHadOutput && !this.turnErrored && !this.turnHadThinking) {
        this.status = 'error';
        this.onEvent({
          kind: 'session_error',
          message: this.annotate(
            'Model returned no output — the turn ended without assistant text and omp reported no error. Try a different model.',
          ),
        });
      }
    } finally {
      if (this.status === 'running') this.status = 'idle';
    }
  }

  async compact(customInstructions?: string): Promise<void> {
    const omp = this.#require();
    await omp.compact(customInstructions);
  }

  async dispose(): Promise<void> {
    const omp = this.omp;
    this.omp = null;
    this.status = 'closed';
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

  constructor(opts: EngineServiceOptions = {}) {
    this.opts = opts;
    // Availability is provisional until start() performs the real dynamic
    // import: bun's createRequire() does not go through the ESM exports map,
    // so probing with require.resolve() is unreliable here.
    this.available = isBunRuntime() || opts.force === true;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get availabilityError(): string | null {
    return this.loadError;
  }

  /** Idempotent startup: realize the model registry snapshot. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.available) return;
    try {
      const { ModelRegistry, discoverAuthStorage } = await this.#importSdk();
      const auth = await discoverAuthStorage();
      const registry = new ModelRegistry(auth);
      await registry.refresh();
      this.authStorage = auth;
      this.registry = registry;
    } catch (err) {
      this.available = false;
      this.loadError = err instanceof Error ? err.message : String(err);
    }
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

  async listModels(): Promise<ProviderModelGroup[]> {
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
        models: models.slice(0, 200),
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
    if (!model) throw new Error(`Model not found: ${selector.provider}/${selector.modelId}`);
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
      if (problem) throw new Error(problem);
    } catch (err) {
      if (err instanceof Error && /is not served by the provider/.test(err.message)) throw err;
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
      // Thread the session cwd into omp's SessionManager too — tools
      // (bash/read/edit) take their working directory from
      // sessionManager.getCwd(), so without it they run in the process cwd.
      sessionManager: SessionManager.inMemory(opts.cwd),
      authStorage: this.authStorage,
      modelRegistry: this.registry,
      cwd: opts.cwd,
      model,
      enableMCP: false,
      enableLsp: false,
    } as never);
    session.attach((created as { session: OmpSessionLike }).session);
    this.sessions.set(id, session);
    return session;
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

  /** Broadcast an event from a session to whoever subscribed (WS hub installs this). */
  onBroadcast: ((sessionId: string, ev: SessionTurnEvent) => void) | null = null;

  private emit(session: EngineSession, ev: SessionTurnEvent): void {
    if (this.onBroadcast) this.onBroadcast(session.id, ev);
  }

  /** Build a GUI-facing summary for a session. */
  toSummary(session: EngineSession): SessionSummary {
    const model = session.model;
    const createdAt = new Date().toISOString();
    return {
      id: session.id,
      name: session.id,
      cwd: session.cwd,
      model,
      status: session.status,
      messageCount: session.messageCount,
      createdAt,
    };
  }

  async listSessionMessages(id: string): Promise<SessionMessage[]> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return [];
  }

  /** Rich transcript from a live session's journal (loop/session inspection). */
  transcriptOf(id: string): SessionTranscriptEntry[] | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    return session.listTranscript();
  }
}
