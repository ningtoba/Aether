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
    this.status = 'running';
    try {
      await omp.prompt(message);
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

  get messageCount(): number {
    return this.count;
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
        const delta = (e?.assistantMessageEvent as Record<string, unknown>)?.delta;
        const block = (e?.assistantMessageEvent as Record<string, unknown>)?.block;
        const kind = block === 'thinking' ? 'thinking' : 'assistant';
        if (typeof delta === 'string') {
          this.onEvent({ kind: 'message_update', role: kind, delta, turn: 0 });
        }
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

  /** Create a new agent session, attached to the omp engine. */
  async createSession(opts: {
    cwd: string;
    model: { provider: string; modelId: string };
  }): Promise<EngineSession> {
    await this.start();
    if (!this.registry || !this.authStorage) throw new EngineUnavailableError();
    const sdk = await this.#importSdk();
    const model = await this.resolveModel(opts.model);

    const id = `ses_${this.nextSessionId++}`;
    const session = new EngineSession({
      id,
      cwd: opts.cwd,
      onEvent: (ev) => this.emit(session, ev),
    });
    const { createAgentSession, SessionManager } = sdk;
    const created = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
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
}
