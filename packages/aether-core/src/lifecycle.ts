export type LifecycleStage = 'init' | 'ready' | 'running' | 'stopping' | 'stopped';

export type LifecycleHook = () => void | Promise<void>;

/** Manages application lifecycle stages with hook support */
export class LifecycleManager {
  private _stage: LifecycleStage = 'init';
  private hooks = new Map<LifecycleStage, LifecycleHook[]>();
  private error?: Error;

  get stage(): LifecycleStage {
    return this._stage;
  }

  get isRunning(): boolean {
    return this._stage === 'running';
  }

  get isStopped(): boolean {
    return this._stage === 'stopped';
  }

  get lastError(): Error | undefined {
    return this.error;
  }

  /** Register a hook for a lifecycle transition */
  on(stage: LifecycleStage, hook: LifecycleHook): () => void {
    if (!this.hooks.has(stage)) this.hooks.set(stage, []);
    this.hooks.get(stage)!.push(hook);
    return () => {
      const arr = this.hooks.get(stage);
      if (arr) {
        const idx = arr.indexOf(hook);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /** Transition to a new stage, running hooks */
  async transition(stage: LifecycleStage): Promise<void> {
    this._stage = stage;
    const hooks = this.hooks.get(stage) ?? [];
    for (const hook of hooks) {
      try {
        await hook();
      } catch (err) {
        this.error = err instanceof Error ? err : new Error(String(err));
        console.error(`Lifecycle hook failed at stage "${stage}":`, this.error);
      }
    }
  }

  /** Start the lifecycle (init -> ready -> running) */
  async start(): Promise<void> {
    await this.transition('init');
    await this.transition('ready');
    await this.transition('running');
  }

  /** Stop the lifecycle (running -> stopping -> stopped) */
  async stop(): Promise<void> {
    await this.transition('stopping');
    await this.transition('stopped');
  }
}
