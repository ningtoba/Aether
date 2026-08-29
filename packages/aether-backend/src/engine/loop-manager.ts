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

export class LoopManager {
  private definitions = new Map<string, LoopDefinition>();
  private runners = new Map<string, LoopRunner>();
  private engine: EngineService;
  private skills: SkillsService;

  constructor(engine: EngineService, skills: SkillsService) {
    this.engine = engine;
    this.skills = skills;
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
    return saved;
  }

  remove(id: string): boolean {
    const runner = this.runners.get(id);
    if (runner && (runner.status === 'running' || runner.status === 'gated')) {
      return false; // cannot delete a running loop
    }
    this.runners.delete(id);
    return this.definitions.delete(id);
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

    const session = await this.engine.createSession({
      cwd: definition.cwd || process.cwd(),
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
