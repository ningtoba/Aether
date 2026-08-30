/**
 * LoopManager — registry + control surface for loops.
 *
 * Owns the set of defined loops and their active LoopRunners, connecting the
 * GUI's REST control verbs (start / stop / advance-gate) to a running loop and
 * forwarding loop events to the broadcast hub.
 */
import type { LoopDefinition, LoopEvent, LoopProgress } from './types.js';
import { LoopRunner } from './loop-runner.js';
import type { EngineService, EngineSession } from './engine-service.js';
import type { SkillsService } from './skills.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export interface LoopManagerOptions {
  /** Directory for persistent loop definitions (JSON). Omit for in-memory only. */
  storeDir?: string;
}

export class LoopManager {
  private definitions = new Map<string, LoopDefinition>();
  private runners = new Map<string, LoopRunner>();
  private engine: EngineService;
  private skills: SkillsService;
  private storeFile: string | null = null;

  constructor(engine: EngineService, skills: SkillsService, opts: LoopManagerOptions = {}) {
    this.engine = engine;
    this.skills = skills;

    if (opts.storeDir) {
      try {
        mkdirSync(opts.storeDir, { recursive: true });
        this.storeFile = join(opts.storeDir, 'loops.json');
        this.loadFromDisk();
      } catch {
        // Persistence is best-effort; fall back to in-memory.
        this.storeFile = null;
      }
    }
  }

  /** Load loop definitions persisted on disk (e.g. from a previous boot). */
  private loadFromDisk(): void {
    if (!this.storeFile || !existsSync(this.storeFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.storeFile, 'utf8')) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [];
      for (const raw of arr) {
        if (isLoopDefinition(raw)) {
          this.definitions.set(raw.id, raw);
        }
      }
    } catch {
      /* corrupt store — keep in-memory only */
    }
  }

  /** Write all loop definitions to disk (best-effort). */
  private persist(): void {
    if (!this.storeFile) return;
    try {
      writeFileSync(this.storeFile, JSON.stringify(Array.from(this.definitions.values()), null, 2));
    } catch {
      /* best-effort */
    }
  }

  /** Broadcast consumer installed by the API layer. */
  onBroadcast: ((ev: LoopEvent) => void) | null = null;

  list(): LoopDefinition[] {
    return Array.from(this.definitions.values());
  }

  get(id: string): LoopDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Persist a loop definition (create or replace by id). */
  save(definition: LoopDefinition): LoopDefinition {
    const id = definition.id || crypto.randomUUID();
    const saved: LoopDefinition = { ...definition, id };
    this.definitions.set(id, saved);
    this.persist();
    return saved;
  }

  remove(id: string): boolean {
    const runner = this.runners.get(id);
    if (runner && (runner.status === 'running' || runner.status === 'gated')) {
      return false; // cannot delete a running loop
    }
    this.runners.delete(id);
    const removed = this.definitions.delete(id);
    if (removed) this.persist();
    return removed;
  }

  /** Start (or resume) a defined loop on a fresh session. */
  async start(id: string): Promise<LoopProgress> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Loop not found: ${id}`);
    if (this.runners.has(id)) {
      const existing = this.runners.get(id)!;
      if (existing.status === 'running' || existing.status === 'gated') {
        throw new Error(`Loop already running: ${id}`);
      }
      this.runners.delete(id);
    }

    // LoopDefinition.cwd is required and the save route always stores the
    // WorkspacesService-validated ABSOLUTE path. A blank or relative cwd means
    // a corrupt/legacy store entry — refuse to start rather than silently run
    // the loop in a guessed directory (the old process.cwd() fallback meant
    // /app in Docker, i.e. the backend's own source tree).
    if (!definition.cwd || !isAbsolute(definition.cwd)) {
      throw new Error(
        `Loop ${id} has no absolute working directory — open it in the GUI, pick a directory, and save before starting`,
      );
    }
    const session = await this.engine.createSession({
      cwd: definition.cwd,
      model: definition.model,
    });
    const runner = new LoopRunner(definition, session, {
      onEvent: (ev) => {
        if (this.onBroadcast) this.onBroadcast(ev);
      },
      readSkill: async (name) => {
        const skill = await this.skills.get(name);
        if (!skill) return null;
        return { name: skill.name, body: skill.body };
      },
    });

    this.runners.set(id, runner);
    void runner.start().catch((err) => {
      this.broadcast({
        kind: 'loop:round_error',
        loopId: id,
        round: runner.progress.currentRound,
        message: err instanceof Error ? err.message : String(err),
      });
      this.runners.delete(id);
    });
    return runner.progress;
  }

  /** Manual stop (works while running or gated). */
  async stop(id: string): Promise<LoopProgress | undefined> {
    const runner = this.runners.get(id);
    if (!runner) return this.progressOf(id);
    await runner.stop('manual stop');
    this.runners.delete(id);
    return runner.progress;
  }

  /** GUI decision on a gated loop: continue or stop. */
  advance(id: string, action: 'continue' | 'stop'): LoopProgress | undefined {
    const runner = this.runners.get(id);
    if (!runner) return this.progressOf(id);
    if (runner.status !== 'gated') return runner.progress;
    if (action === 'continue') runner.continueOnceGate();
    else void runner.stopOnceGate();
    return runner.progress;
  }

  progressOf(id: string): LoopProgress | undefined {
    const runner = this.runners.get(id);
    if (!runner) return undefined;
    return runner.progress;
  }

  listProgress(): LoopProgress[] {
    return Array.from(this.runners.values()).map((r) => r.progress);
  }

  private broadcast(ev: LoopEvent): void {
    if (this.onBroadcast) this.onBroadcast(ev);
  }
}

/** Runtime shape guard for loop definitions loaded from the on-disk store. */
function isLoopDefinition(value: unknown): value is LoopDefinition {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.prompt === 'string' && isProviderModel(v.model);
}

function isProviderModel(value: unknown): value is { provider: string; modelId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'provider' in value &&
    typeof value.provider === 'string' &&
    'modelId' in value &&
    typeof value.modelId === 'string'
  );
}
