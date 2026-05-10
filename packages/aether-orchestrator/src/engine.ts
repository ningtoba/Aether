import { StateGraph, MemorySaver, START, END, Annotation } from "@langchain/langgraph";
import type { CompiledStateGraph } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { NodeDefinition, EdgeDefinition, WorkflowDefinition, WorkflowState, NodeExecution, NodeId, OrchestrationConfig, Checkpoint, CheckpointManager } from "./types.js";
import { DEFAULT_ORCHESTRATION_CONFIG } from "./types.js";
import { InMemoryCheckpointManager } from "./checkpoint.js";
import type { EventBus } from "@aether/core";

const AetherState = Annotation.Root({
  data: Annotation<Record<string, unknown>>({
    reducer: (a: Record<string, unknown>, b: Record<string, unknown>) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  executionId: Annotation<string>({ reducer: (a: string, b: string) => a ?? b, default: () => "" }),
  workflowId: Annotation<string>({ reducer: (a: string, b: string) => a ?? b, default: () => "" }),
  nodeHistory: Annotation<NodeExecution[]>({
    reducer: (a: NodeExecution[], b: NodeExecution[]) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
  status: Annotation<string>({ reducer: (a: string, b: string) => b ?? a, default: () => "pending" }),
  error: Annotation<string | undefined>({ reducer: (a, b) => b ?? a, default: () => undefined }),
  nodeId: Annotation<string | undefined>({ reducer: (a, b) => b ?? a, default: () => undefined }),
  startedAt: Annotation<string>({ reducer: (a: string, b: string) => a ?? b, default: () => new Date().toISOString() }),
  lastCheckpointAt: Annotation<string | undefined>({ reducer: (a, b) => b ?? a, default: () => undefined }),
  version: Annotation<number>({ reducer: (a: number, b: number) => Math.max(a ?? 0, b ?? 0), default: () => 1 }),
});

type StateType = typeof AetherState.StateType;
export type { StateType };

function resolveInput(nodeDef: NodeDefinition, state: StateType): unknown {
  if (!nodeDef.inputMapping || Object.keys(nodeDef.inputMapping).length === 0) return { ...state.data };
  const input: Record<string, unknown> = {};
  for (const [inputKey, stateKey] of Object.entries(nodeDef.inputMapping))
    input[inputKey] = state.data[stateKey];
  return input;
}

function applyOutputMapping(nodeDef: NodeDefinition, output: unknown): Record<string, unknown> {
  if (nodeDef.outputMapping && typeof output === "object" && output !== null) {
    const update: Record<string, unknown> = {};
    for (const [stateKey, outputKey] of Object.entries(nodeDef.outputMapping))
      update[stateKey] = (output as Record<string, unknown>)[outputKey];
    return update;
  }
  return { [`${nodeDef.id}.output`]: output };
}

function evaluateConditions(edge: EdgeDefinition, state: StateType): boolean {
  if (!edge.conditions || edge.conditions.length === 0) return true;
  for (const c of edge.conditions) {
    const v = c.field.split(".").reduce((val: unknown, p: string) =>
      val !== null && typeof val === "object" ? (val as Record<string, unknown>)[p] : undefined, state as unknown);
    let match = false;
    switch (c.operator) {
      case "eq": match = v === c.value; break;
      case "neq": match = v !== c.value; break;
      case "gt": match = (v as number) > (c.value as number); break;
      case "gte": match = (v as number) >= (c.value as number); break;
      case "lt": match = (v as number) < (c.value as number); break;
      case "lte": match = (v as number) <= (c.value as number); break;
      case "exists": match = v !== undefined && v !== null; break;
      case "matches": {
        if (typeof v === "string" && typeof c.value === "string") {
          try { match = new RegExp(c.value).test(v); } catch { match = v.includes(c.value); }
        }
        break;
      }
    }
    if (!match) return false;
  }
  return true;
}

async function executeAgentNode(nodeDef: NodeDefinition, input: unknown): Promise<unknown> {
  return { status: "ok", agentName: nodeDef.agentName ?? "unknown", result: `[agent] ${nodeDef.agentName ?? "unknown"} processed input`, inputReceived: input };
}
async function executeToolNode(nodeDef: NodeDefinition, input: unknown): Promise<unknown> {
  return { status: "ok", toolName: nodeDef.toolName ?? "unknown", result: `[tool] ${nodeDef.toolName ?? "unknown"} executed`, inputReceived: input };
}
async function executeRouterNode(_: NodeDefinition, input: unknown): Promise<unknown> {
  return { status: "ok", route: "evaluated", inputReceived: input };
}
async function executeMapNode(_: NodeDefinition, input: unknown): Promise<unknown> {
  return { status: "ok", kind: "map", itemCount: (Array.isArray(input) ? input : [input]).length, itemsProcessed: 0 };
}
async function executeReduceNode(_: NodeDefinition, input: unknown): Promise<unknown> {
  return { status: "ok", kind: "reduce", mergedResult: input };
}
async function executeSubgraphNode(nodeDef: NodeDefinition, input: unknown, engine: LangGraphEngine): Promise<unknown> {
  if (!nodeDef.subgraphId) throw new Error("Subgraph node has no subgraphId");
  const fn = engine.getSubgraphExecutor(nodeDef.subgraphId);
  return fn ? fn(input) : { status: "ok", subgraphId: nodeDef.subgraphId, result: "[simulated]" };
}
async function executeSleepNode(nodeDef: NodeDefinition, _: unknown): Promise<unknown> {
  await new Promise(r => setTimeout(r, nodeDef.timeout ?? 1000));
  return { status: "ok", slept: nodeDef.timeout ?? 1000 };
}
async function executeSignalNode(_: NodeDefinition): Promise<unknown> {
  return { status: "paused", kind: "signal", message: "Waiting for external signal." };
}

const EXECUTORS: Record<string, (n: NodeDefinition, i: unknown, e: LangGraphEngine, s: StateType) => Promise<unknown>> = {
  agent: executeAgentNode, tool: executeToolNode, router: executeRouterNode,
  map: executeMapNode, reduce: executeReduceNode, subgraph: executeSubgraphNode,
  sleep: executeSleepNode, signal: executeSignalNode,
};

function buildRunner(nodeDef: NodeDefinition, engine: LangGraphEngine) {
  const exec = EXECUTORS[nodeDef.kind];
  if (!exec) throw new Error("Unknown node kind: " + nodeDef.kind);
  return async (state: StateType, _config: RunnableConfig): Promise<Partial<StateType>> => {
    const ne: NodeExecution = { nodeId: nodeDef.id, status: "running", attempt: 1, startedAt: Date.now() };
    try {
      const input = resolveInput(nodeDef, state);
      const output = await exec(nodeDef, input, engine, state);
      ne.status = "completed";
      ne.completedAt = Date.now();
      ne.output = output;
      return { data: applyOutputMapping(nodeDef, output), nodeHistory: [ne], status: state.status, nodeId: nodeDef.id, version: (state.version ?? 0) + 1 };
    } catch (err) {
      ne.status = "failed";
      ne.error = err instanceof Error ? err.message : String(err);
      return { nodeHistory: [ne], status: "failed", error: ne.error, nodeId: nodeDef.id };
    }
  };
}

export class LangGraphEngine {
  private compiled = new Map<string, CompiledStateGraph<typeof AetherState, any>>();
  private workflows = new Map<string, WorkflowDefinition>();
  readonly config: OrchestrationConfig;
  readonly checkpointer: MemorySaver;
  private legacy: CheckpointManager;
  private eventBus?: EventBus;
  private subExec = new Map<string, (i: unknown) => Promise<unknown>>();

  constructor(config?: Partial<OrchestrationConfig>) {
    this.config = { ...DEFAULT_ORCHESTRATION_CONFIG, ...config };
    this.checkpointer = new MemorySaver();
    this.legacy = config?.checkpointManager ?? new InMemoryCheckpointManager();
  }

  registerWorkflow(w: WorkflowDefinition): CompiledStateGraph<typeof AetherState, any> {
    this.workflows.set(w.id, w);
    const c = this.compile(w);
    this.compiled.set(w.id, c);
    return c;
  }

  registerSubgraphExecutor(id: string, fn: (i: unknown) => Promise<unknown>): void { this.subExec.set(id, fn); }
  getSubgraphExecutor(id: string) { return this.subExec.get(id); }

  async execute(wf: WorkflowDefinition | string, init?: Record<string, unknown>, opts?: { threadId?: string }): Promise<WorkflowState> {
    let w: WorkflowDefinition;
    let c: CompiledStateGraph<typeof AetherState, any>;
    if (typeof wf === "string") {
      w = this.workflows.get(wf)!;
      c = this.compiled.get(wf)!;
      if (!w || !c) throw new Error("Workflow \"" + wf + "\" not registered");
    } else {
      w = wf;
      c = this.registerWorkflow(w);
    }
    const tid = opts?.threadId ?? "t-" + Date.now();
    const eid = "exec-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const d: Record<string, unknown> = { ...init };
    for (const [k, f] of Object.entries(w.initialState)) if (d[k] === undefined && f.default !== undefined) d[k] = f.default;
    this.emit("orchestrator.execute", { workflowId: w.id, executionId: eid, threadId: tid });
    try {
      const r = await c.invoke({ data: d, executionId: eid, workflowId: w.id, status: "running", nodeHistory: [], startedAt: new Date().toISOString(), version: 1 } as StateType,
        { configurable: { thread_id: tid } });
      const s: WorkflowState = { executionId: eid, workflowId: w.id, currentNode: r.nodeId ?? null, nodeHistory: r.nodeHistory ?? [], data: r.data ?? {},
        status: r.status === "failed" ? "failed" : "completed", error: r.error, startedAt: r.startedAt ?? new Date().toISOString(),
        lastCheckpointAt: r.lastCheckpointAt ?? new Date().toISOString(), version: r.version ?? 1 };
      await this.saveLegacy(s);
      this.emit("orchestrator.complete", { workflowId: w.id, executionId: eid, status: s.status });
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("orchestrator.error", { workflowId: w.id, executionId: eid, error: msg });
      return { executionId: eid, workflowId: w.id, currentNode: null, nodeHistory: [], data: d, status: "failed", error: msg, startedAt: new Date().toISOString(), version: 1 };
    }
  }

  private compile(w: WorkflowDefinition): CompiledStateGraph<typeof AetherState, any> {
    const g = new StateGraph(AetherState as any);
    for (const n of w.nodes) g.addNode("_" + n.id, buildRunner(n, this));
    const srcMap = new Map<string, EdgeDefinition[]>();
    for (const e of w.edges) { const a = srcMap.get(e.from) ?? []; a.push(e); srcMap.set(e.from, a); }
    const has = (id: string) => w.nodes.some((n) => n.id === id);
    const term = (id: string) => w.terminalNodes.includes(id);
    for (const [src, edges] of srcMap) {
      if (!has(src)) continue;
      const s = "_" + src;
      if (edges.length === 1 && edges[0]!.kind === "direct") {
        const ed = edges[0]!;
        g.addEdge(s, has(ed.to) ? "_" + ed.to : END);
      } else {
        const router = async (st: StateType): Promise<string> => {
          for (const ed of edges) {
            if (ed.kind === "direct") return "_" + ed.to;
            if (ed.kind === "conditional" && evaluateConditions(ed, st)) return "_" + ed.to;
          }
          return END;
        };
        const pm: Record<string, string> = {};
        for (const ed of edges) pm[ed.to] = has(ed.to) ? "_" + ed.to : END;
        g.addConditionalEdges(s, router, pm);
      }
    }
    if (w.entryNode && has(w.entryNode)) g.addEdge(START, "_" + w.entryNode);
    for (const t of w.terminalNodes) if (!srcMap.has(t) && has(t)) g.addEdge("_" + t, END);
    return g.compile({ checkpointer: this.checkpointer });
  }

  listWorkflows() { return Array.from(this.workflows.values()).map(w => ({ id: w.id, name: w.name, version: w.version })); }
  getWorkflow(id: string) { return this.workflows.get(id); }
  unregisterWorkflow(id: string) { this.workflows.delete(id); return this.compiled.delete(id); }
  getLegacyCheckpointer() { return this.legacy; }
  setEventBus(bus: EventBus) { this.eventBus = bus; }
  clear() { this.compiled.clear(); this.workflows.clear(); this.legacy.clear(); }

  private async saveLegacy(s: WorkflowState) {
    await this.legacy.save({ id: "cp-" + s.version + "-" + Date.now(), executionId: s.executionId, state: JSON.parse(JSON.stringify(s)), createdAt: new Date().toISOString(), label: "v" + s.version });
  }
  private emit(ev: string, d: Record<string, unknown>) { this.eventBus?.publish(ev, d).catch(() => {}); }
}
