/**
 * LoopManager — registry + control surface for loops.
 *
 * Owns the set of defined loops and their active LoopRunners, connecting the
 * GUI's REST control verbs (start / stop / advance-gate) to a running loop and
 * forwarding loop events to the broadcast hub.
 */
import type { LoopDefinition, LoopEvent, LoopProgress } from './types.js';
import { LOOP_TRANSITION_KINDS } from './types.js';
import { LoopRunner } from './loop-runner.js';
import type { EngineService, EngineSession } from './engine-service.js';
import type { SkillsService } from './skills.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export interface LoopManagerOptions {
  /** Directory for persistent loop definitions (JSON). Omit for in-memory only. */
  storeDir?: string;
}

export class LoopManager {
  private definitions = new Map<string, LoopDefinition>();
  private runners = new Map<string, LoopRunner>();
  /** In-flight start() reservations (loop id → ownership ticket). A start is
   *  not atomic — between the guard and `await createSession` a second
   *  concurrent start() would sail past the runners.has(id) check and give
   *  the loop two live runners. This map closes that window synchronously. */
  private starting = new Map<string, symbol>();
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.storeFile, 'utf8'));
    } catch (err) {
      this.quarantineStore(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!Array.isArray(parsed)) {
      this.quarantineStore('top-level JSON is not an array');
      return;
    }
    for (const raw of parsed) {
      if (isLoopDefinition(raw)) {
        this.definitions.set(raw.id, raw);
      } else {
        // One corrupt entry (hand-edited, or written by an older build) must
        // not silently take the healthy majority with it: skip ONLY this one,
        // loudly — yet identify it by id/name FIELDS ONLY. A corrupt entry is
        // arbitrary hand-edit data (prompts, paths); never log it wholesale.
        let ident = `<${typeof raw}>`;
        if (raw !== null && typeof raw === 'object') {
          const id = 'id' in raw ? String(raw.id) : '?';
          const name = 'name' in raw ? String(raw.name) : '?';
          ident = `id=${id} name=${name}`;
        }
        console.error(`[LoopManager] skipping invalid loop store entry: ${ident}`);
      }
    }
  }

  /** A corrupt store is RENAMED (never silently overwritten — the next
   *  persist() would erase the evidence) and the process keeps serving an
   *  empty store from memory. */
  private quarantineStore(reason: string): void {
    const file = this.storeFile;
    if (!file) return;
    // Colon/dot-stripped ISO timestamp: ':' is illegal in Windows filenames.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = `${file}.corrupt-${stamp}`;
    try {
      renameSync(file, quarantine);
      console.error(
        `[LoopManager] loop store ${file} is corrupt (${reason}); quarantined to ${quarantine} — continuing with an empty store`,
      );
    } catch (moveErr) {
      console.error(
        `[LoopManager] loop store ${file} is corrupt (${reason}) and could NOT be quarantined (${
          moveErr instanceof Error ? moveErr.message : String(moveErr)
        }); continuing with an empty store — the next save will overwrite it`,
      );
    }
  }

  /** Write all loop definitions to disk. Best-effort, but ATOMIC: a crash
   *  between truncate and write used to leave a half-written loops.json that
   *  loadFromDisk then treated as corrupt on the next boot. */
  private persist(): void {
    if (!this.storeFile) return;
    const tmp = `${this.storeFile}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(Array.from(this.definitions.values()), null, 2));
      renameSync(tmp, this.storeFile);
    } catch (err) {
      // Best-effort still means LOUD: a silently lost save is how the store
      // starts lying about what exists.
      console.error(
        `[LoopManager] persist failed (${this.storeFile}): ${err instanceof Error ? err.message : String(err)}`,
      );
      rmSync(tmp, { force: true });
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
    if (
      this.starting.has(id) ||
      (runner && (runner.status === 'running' || runner.status === 'gated'))
    ) {
      return false; // cannot delete a running — or still starting — loop
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
    if (this.starting.has(id)) {
      // The runner does not exist yet, but the slot is claimed: report the
      // same error text the settled-runner guard uses (callers/tests pin it).
      throw new Error(`Loop already running: ${id}`);
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

    // Reserve the slot BEFORE the first await. Everything from here to
    // runners.set() is failure-atomic: any throw releases OUR reservation
    // (ticket-checked) and disposes a session that did materialise, so a
    // rejected start never leaves an orphan runner or a leaked omp session.
    const ticket = Symbol(`start:${id}`);
    this.starting.set(id, ticket);
    let session: EngineSession | undefined;
    try {
      session = await this.engine.createSession({
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
      this.starting.delete(id);
      this.runners.set(id, runner);
      void runner
        .start()
        .catch((err) => {
          this.broadcast({
            kind: 'loop:round_error',
            loopId: id,
            round: runner.progress.currentRound,
            message: err instanceof Error ? err.message : String(err),
          });
          this.runners.delete(id);
        })
        // start() settles on BOTH remaining terminal paths (normal completion
        // via finish(), and the rejection handled above) — dispose there so no
        // loop run leaks its omp session.
        .finally(() => this.disposeLoopSession(id, session!.id));
      return runner.progress;
    } catch (err) {
      // Only clear the reservation if it is still OURS (never clobber a
      // newer owner), and dispose the session a failed construction left
      // behind — the loop owns every session it creates.
      if (this.starting.get(id) === ticket) this.starting.delete(id);
      if (session) this.disposeLoopSession(id, session.id);
      throw err;
    }
  }

  /** Dispose the omp session a loop run owns. The loop CREATED this session,
   *  so every terminal path must dispose it. Best-effort but loud: a disposal
   *  failure never throws into the route that triggered the terminal path. */
  private disposeLoopSession(loopId: string, sessionId: string | undefined): void {
    if (!sessionId) return;
    this.engine.disposeSession(sessionId).catch((err) => {
      console.error(
        `[LoopManager] session dispose failed (loop ${loopId}, session ${sessionId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /** Manual stop (works while running or gated). */
  async stop(id: string): Promise<LoopProgress | undefined> {
    const runner = this.runners.get(id);
    if (!runner) return this.progressOf(id);
    await runner.stop('manual stop');
    this.runners.delete(id);
    // Dispose now, not only when the in-flight chain settles: a mid-round stop
    // leaves runner.start() awaiting the prompt, so its .finally dispose could
    // linger indefinitely. A repeat dispose from that finally is a no-op
    // (EngineService.disposeSession returns false once the id is gone).
    this.disposeLoopSession(id, runner.progress.sessionId);
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

/** Runtime shape guard for loop definitions loaded from the on-disk store.
 *  Deliberately STRICTER than a bare typeof check: the store is hand-editable
 *  and older builds wrote looser shapes, and every field validated here is a
 *  field the runner will blindly dereference at start() time. */
function isLoopDefinition(value: unknown): value is LoopDefinition {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.prompt !== 'string') return false;
  if (!isProviderModel(v.model)) return false;

  const t = v.transition;
  if (!t || typeof t !== 'object') return false;
  const tr = t as Record<string, unknown>;
  if (
    typeof tr.kind !== 'string' ||
    !(LOOP_TRANSITION_KINDS as readonly string[]).includes(tr.kind)
  ) {
    return false;
  }
  // A stored non-string skillName/args would crash the runner's
  // `.trim()` / `{round}` substitution mid-loop.
  if (tr.skillName !== undefined && typeof tr.skillName !== 'string') return false;
  if (tr.args !== undefined && typeof tr.args !== 'string') return false;

  // The runner treats maxRounds as an EXACT integer round count; 0, floats
  // and negatives are store corruption (the save route only ever persists
  // undefined or an integer >= 1).
  if (v.maxRounds !== undefined && !(Number.isInteger(v.maxRounds) && Number(v.maxRounds) >= 1)) {
    return false;
  }
  // Mirror start()'s cwd rule: an entry that survived with a relative cwd is
  // a corrupt/legacy shape — refuse the entry rather than resurrect it (absent
  // cwd is allowed: start() refuses those with the actionable GUI message).
  if (v.cwd !== undefined && !(typeof v.cwd === 'string' && isAbsolute(v.cwd))) return false;
  return true;
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
