import { StateGraph, MemorySaver, START, END } from '@langchain/langgraph';
import { Annotation } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  NodeDefinition,
  EdgeDefinition,
  WorkflowDefinition,
  WorkflowState,
  NodeExecution,
  NodeId,
  OrchestrationConfig,
  Checkpoint,
  CheckpointManager,
} from './types.js';
import { DEFAULT_ORCHESTRATION_CONFIG } from './types.js';
import { InMemoryCheckpointManager } from './checkpoint.js';
import type { EventBus } from '@aether/core';

const AetherState = Annotation.Root({
  data: Annotation<Record<string, unknown>>({
    reducer: (a: Record<string, unknown>, b: Record<string, unknown>) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  status: Annotation<string>({
    reducer: (a: string, b: string) => (a === 'paused' ? 'paused' : (b ?? a)),
    default: () => '',
  }),
  error: Annotation<string | undefined>({
    reducer: (a: string | undefined, b: string | undefined) => b ?? a,
    default: () => undefined,
  }),
  executionId: Annotation<string>({
    reducer: (a: string, b: string) => a ?? b,
    default: () => '',
  }),
  workflowId: Annotation<string>({
    reducer: (a: string, b: string) => a ?? b,
    default: () => '',
  }),
  startedAt: Annotation<string>({
    reducer: (a: string, b: string) => a ?? b,
    default: () => '',
  }),
  lastNode: Annotation<string>({
    reducer: (a: string, b: string) => b ?? a,
    default: () => '',
  }),
});

type S = Record<string, unknown>;

function makeRunner(nodeDef: NodeDefinition): (state: S, _config: RunnableConfig) => Promise<S> {
  return async (state: S, _config: RunnableConfig): Promise<S> => {
    const input = (state.data as Record<string, unknown>) || {};
    let output: unknown;
    let status = 'running';
    let error: string | undefined;
    try {
      switch (nodeDef.kind) {
        case 'agent':
          output = { status: 'ok', agentName: nodeDef.agentName ?? 'unknown' };
          break;
        case 'tool':
          output = { status: 'ok', toolName: nodeDef.toolName ?? 'unknown' };
          break;
        case 'router':
          output = { status: 'ok', route: 'evaluated' };
          break;
        case 'map':
          output = { status: 'ok', kind: 'map' };
          break;
        case 'reduce':
          output = { status: 'ok', kind: 'reduce' };
          break;
        case 'subgraph':
          output = { status: 'ok', subgraphId: nodeDef.subgraphId };
          break;
        case 'sleep':
          await new Promise((r) => setTimeout(r, nodeDef.timeout ?? 10));
          output = { status: 'ok' };
          break;
        case 'signal':
          output = { status: 'paused' };
          status = 'paused';
          break;
        default:
          throw new Error('Unknown node kind: ' + nodeDef.kind);
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }
    const data = { ...((state.data as Record<string, unknown>) || {}) };
    data[nodeDef.id + '.output'] = output;
    if (error) data[nodeDef.id + '.error'] = error;
    return { data, status, error, lastNode: nodeDef.id };
  };
}

export class LangGraphEngine {
  private compiled = new Map<string, any>();
  private workflows = new Map<string, WorkflowDefinition>();
  readonly config: OrchestrationConfig;
  readonly checkpointer: MemorySaver;
  private legacy: CheckpointManager;
  private eventBus?: EventBus;
  private nodeHistory = new Map<string, NodeExecution[]>();

  constructor(config?: Partial<OrchestrationConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATION_CONFIG, ...config };
    this.checkpointer = new MemorySaver();
    this.legacy = config?.checkpointManager ?? new InMemoryCheckpointManager();
  }

  registerWorkflow(w: WorkflowDefinition): any {
    this.workflows.set(w.id, w);
    return this.compile(w);
  }

  async execute(
    wf: WorkflowDefinition | string,
    init?: Record<string, unknown>,
    opts?: { threadId?: string },
  ): Promise<WorkflowState> {
    let w: WorkflowDefinition;
    let c: any;
    if (typeof wf === 'string') {
      w = this.workflows.get(wf)!;
      c = this.compiled.get(wf);
      if (!w || !c) throw new Error('Workflow "' + wf + '" not registered');
    } else {
      w = wf;
      c = this.compile(w);
    }
    const tid = opts?.threadId ?? 't-' + Date.now();
    const eid = 'exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const d: Record<string, unknown> = { ...init };
    for (const [k, f] of Object.entries(w.initialState))
      if (d[k] === undefined && f.default !== undefined) d[k] = f.default;

    const history: NodeExecution[] = [];
    this.emit('execute', { workflowId: w.id, executionId: eid });
    try {
      const r: S = await c.invoke(
        {
          data: d,
          status: 'running',
          executionId: eid,
          workflowId: w.id,
          startedAt: new Date().toISOString(),
        },
        { configurable: { thread_id: tid } },
      );

      // Build node history from what we tracked
      const execNodeId = (r.lastNode as string) || '';
      for (const node of w.nodes) {
        const output = (r.data as Record<string, unknown>)[node.id + '.output'];
        const errVal = (r.data as Record<string, unknown>)[node.id + '.error'] as
          | string
          | undefined;
        history.push({
          nodeId: node.id,
          status: errVal ? 'failed' : output ? 'completed' : 'pending',
          attempt: 1,
          ...(errVal ? { error: errVal } : {}),
          ...(output ? { output } : {}),
        });
      }

      const s: WorkflowState = {
        executionId: eid,
        workflowId: w.id,
        currentNode: execNodeId || null,
        nodeHistory: history,
        data: (r.data as Record<string, unknown>) ?? {},
        status: r.error ? 'failed' : r.status === 'paused' ? 'paused' : 'completed',
        error: r.error as string | undefined,
        startedAt: (r.startedAt as string) ?? new Date().toISOString(),
        lastCheckpointAt: new Date().toISOString(),
        version: 1,
      };
      await this.legacy.save({
        id: 'cp-' + Date.now(),
        executionId: eid,
        state: JSON.parse(JSON.stringify(s)),
        createdAt: new Date().toISOString(),
        label: 'v1',
      });
      this.emit('complete', { workflowId: w.id, executionId: eid, status: s.status });
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', { workflowId: w.id, executionId: eid, error: msg });
      return {
        executionId: eid,
        workflowId: w.id,
        currentNode: null,
        nodeHistory: history,
        data: d,
        status: 'failed',
        error: msg,
        startedAt: new Date().toISOString(),
        version: 1,
      };
    }
  }

  private compile(w: WorkflowDefinition): any {
    const g = new (StateGraph as any)(AetherState);

    // Map a raw edge target to a graph node reference; the symbolic end
    // sentinels ('END'/'__end__') resolve to LangGraph's END.
    const ref = (to: string): string => (to === '__end__' || to === 'END' ? END : '_n_' + to);

    // Add nodes  need to use tracked runner
    for (const n of w.nodes) {
      g.addNode('_n_' + n.id, makeRunner(n));
    }

    // Build edge index
    const bySrc = new Map<string, EdgeDefinition[]>();
    for (const e of w.edges) {
      const arr = bySrc.get(e.from) ?? [];
      arr.push(e);
      bySrc.set(e.from, arr);
    }

    const hasNode = (id: string) => w.nodes.some((n) => n.id === id);

    // Connect edges
    for (const [src, edges] of bySrc) {
      if (!hasNode(src)) continue;
      const s = '_n_' + src;

      if (edges.length === 1 && edges[0]!.kind === 'direct') {
        const r = edges[0]!.to;
        g.addEdge(s, hasNode(r) ? '_n_' + r : END);
      } else {
        // Build a routing function that handles fan-out and conditions
        const condEdges = edges.filter((e) => e.kind === 'conditional');
        const directEdges = edges.filter((e) => e.kind === 'direct');

        if (condEdges.length > 0) {
          // Conditional routing: evaluate conditions to choose path
          const router = async (st: S): Promise<string> => {
            const d = (st.data as Record<string, unknown>) || {};
            for (const e of condEdges) {
              if (evalCond(e, d)) return ref(e.to);
            }
            // Fallback to first direct edge
            if (directEdges.length > 0) return ref(directEdges[0]!.to);
            return END;
          };
          const pm: Record<string, string> = {};
          for (const e of edges) pm[ref(e.to)] = ref(e.to);
          // Also allow END as a return path
          pm[END] = END;
          g.addConditionalEdges(s, router, pm);
        } else {
          // Fan-out: all direct edges followed
          for (const e of directEdges) {
            g.addEdge(s, hasNode(e.to) ? '_n_' + e.to : END);
          }
        }
      }
    }

    // START -> entry
    if (w.entryNode && hasNode(w.entryNode)) {
      g.addEdge(START, '_n_' + w.entryNode);
    }

    // Terminals -> END
    for (const t of w.terminalNodes) {
      if (!bySrc.has(t) && hasNode(t)) {
        g.addEdge('_n_' + t, END);
      }
    }

    return g.compile({ checkpointer: this.checkpointer });
  }

  listWorkflows() {
    return Array.from(this.workflows.values()).map((w) => ({
      id: w.id,
      name: w.name,
      version: w.version,
    }));
  }
  getWorkflow(id: string) {
    return this.workflows.get(id);
  }
  unregisterWorkflow(id: string) {
    this.workflows.delete(id);
    return this.compiled.delete(id);
  }
  getLegacyCheckpointer() {
    return this.legacy;
  }
  setEventBus(bus: EventBus) {
    this.eventBus = bus;
  }
  clear() {
    this.compiled.clear();
    this.workflows.clear();
    (this.legacy as any).clear();
  }
  private emit(ev: string, d: Record<string, unknown>) {
    this.eventBus?.publish(ev, d).catch(() => {});
  }
}

function evalCond(e: EdgeDefinition, data: Record<string, unknown>): boolean {
  if (!e.conditions || e.conditions.length === 0) return true;
  for (const c of e.conditions) {
    const parts = c.field.replace('data.', '').split('.');
    let v: unknown = data;
    for (const p of parts)
      v = v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[p] : undefined;
    let match = false;
    switch (c.operator) {
      case 'eq':
        match = v === c.value;
        break;
      case 'neq':
        match = v !== c.value;
        break;
      case 'exists':
        match = v !== undefined && v !== null;
        break;
      case 'gt': {
        const cmp = compareValues(v, c.value);
        match = cmp !== null && cmp > 0;
        break;
      }
      case 'gte': {
        const cmp = compareValues(v, c.value);
        match = cmp !== null && cmp >= 0;
        break;
      }
      case 'lt': {
        const cmp = compareValues(v, c.value);
        match = cmp !== null && cmp < 0;
        break;
      }
      case 'lte': {
        const cmp = compareValues(v, c.value);
        match = cmp !== null && cmp <= 0;
        break;
      }
      case 'matches': {
        if (typeof v === 'string' && typeof c.value === 'string') {
          try {
            match = new RegExp(c.value).test(v);
          } catch {
            match = v.includes(c.value);
          }
        }
        break;
      }
    }
    if (!match) return false;
  }
  return true;
}

/**
 * Compare two values for ordering. Returns a negative/zero/positive number,
 * or `null` when the values are not order-comparable.
 */
function compareValues(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return null;
}
