import type {
  WorkflowDefinition,
  NodeDefinition,
  EdgeDefinition,
  NodeId,
  NodeKind,
  Condition,
} from "./types.js";

/**
 * Fluent builder for constructing WorkflowDefinition graphs.
 *
 * Provides chainable methods for adding nodes, edges, checkpoints,
 * and configuration. Call `.build()` to produce the final definition.
 *
 * @example
 * ```ts
 * const workflow = new WorkflowBuilder("my-workflow", "1.0.0")
 *   .addNode({ id: "start", kind: "agent", agentName: "researcher" })
 *   .addNode({ id: "summarize", kind: "agent", agentName: "summarizer" })
 *   .addEdge({ id: "e1", from: "start", to: "summarize", kind: "direct" })
 *   .withEntry("start")
 *   .withTerminal("summarize")
 *   .build();
 * ```
 */
export class WorkflowBuilder {
  private nodes = new Map<NodeId, NodeDefinition>();
  private edges: EdgeDefinition[] = [];
  private entryNode: NodeId | null = null;
  private terminalNodes: Set<NodeId> = new Set();
  private initialState: WorkflowDefinition["initialState"] = {};
  private version: string;

  constructor(
    public readonly id: string,
    version?: string,
    public readonly name?: string,
    public readonly description?: string,
  ) {
    this.version = version ?? "0.1.0";
  }

  // ─── Node Operations ─────────────────────────────────────

  /** Add or replace a node */
  addNode(node: NodeDefinition): this {
    this.nodes.set(node.id, node);
    return this;
  }

  /** Add a batch of nodes */
  addNodes(nodes: NodeDefinition[]): this {
    for (const n of nodes) this.nodes.set(n.id, n);
    return this;
  }

  /** Remove a node and all edges referencing it */
  removeNode(id: NodeId): this {
    this.nodes.delete(id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    if (this.entryNode === id) this.entryNode = null;
    this.terminalNodes.delete(id);
    return this;
  }

  /** Quick helper: add a single linear agent node */
  agentNode(id: NodeId, agentName: string, description?: string): this {
    return this.addNode({ id, kind: "agent", agentName, description });
  }

  /** Quick helper: add a tool node */
  toolNode(id: NodeId, toolName: string, description?: string): this {
    return this.addNode({ id, kind: "tool", toolName, description });
  }

  /** Quick helper: add a router (LLM-as-router) node */
  routerNode(id: NodeId, label: string, routePrompt: string): this {
    return this.addNode({
      id,
      kind: "router",
      label,
      description: `LLM router: ${label}`,
    });
  }

  /** Quick helper: add a map (parallel fan-out) node */
  mapNode(id: NodeId, label: string): this {
    return this.addNode({ id, kind: "map", label });
  }

  /** Quick helper: add a reduce (fan-in) node */
  reduceNode(id: NodeId, label: string): this {
    return this.addNode({ id, kind: "reduce", label });
  }

  /** Quick helper: add a subgraph node */
  subgraphNode(id: NodeId, subgraphId: string, label?: string): this {
    return this.addNode({ id, kind: "subgraph", subgraphId, label });
  }

  /** Quick helper: add a sleep / delay node */
  sleepNode(id: NodeId, timeout?: number): this {
    return this.addNode({ id, kind: "sleep", timeout });
  }

  // ─── Edge Operations ─────────────────────────────────────

  /** Add a direct edge (no condition — always follows) */
  addEdge(edge: EdgeDefinition): this {
    this.edges.push(edge);
    return this;
  }

  /** Quick helper: add a direct edge between two nodes */
  connect(from: NodeId, to: NodeId, label?: string): this {
    const id = `e-${from}-${to}`;
    return this.addEdge({ id, from, to, kind: "direct", label });
  }

  /** Quick helper: add a conditional edge with conditions */
  connectIf(
    from: NodeId,
    to: NodeId,
    conditions: Condition[],
    label?: string,
  ): this {
    const id = `e-${from}-${to}-${conditions.map((c) => `${c.field}${c.operator}`).join("_")}`;
    return this.addEdge({ id, from, to, kind: "conditional", label, conditions });
  }

  /** Quick helper: add an LLM-routed edge */
  connectViaLLM(
    from: NodeId,
    to: NodeId,
    routePrompt: string,
    label?: string,
  ): this {
    const id = `e-${from}-${to}-llm`;
    return this.addEdge({ id, from, to, kind: "llm-route", label, routePrompt });
  }

  /** Remove an edge by id */
  removeEdge(id: string): this {
    this.edges = this.edges.filter((e) => e.id !== id);
    return this;
  }

  // ─── Configuration ───────────────────────────────────────

  /** Set the entry (start) node */
  withEntry(nodeId: NodeId): this {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Entry node "${nodeId}" does not exist`);
    }
    this.entryNode = nodeId;
    return this;
  }

  /** Add a terminal (end) node */
  withTerminal(nodeId: NodeId): this {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Terminal node "${nodeId}" does not exist`);
    }
    this.terminalNodes.add(nodeId);
    return this;
  }

  /** Set terminal nodes in bulk */
  withTerminals(nodeIds: NodeId[]): this {
    for (const id of nodeIds) this.withTerminal(id);
    return this;
  }

  /** Declare an initial state field */
  withInitialStateField(
    key: string,
    type: string,
    required?: boolean,
    defaultVal?: unknown,
  ): this {
    this.initialState[key] = { type, required, default: defaultVal };
    return this;
  }

  // ─── Build & Validate ────────────────────────────────────

  /**
   * Build and validate the workflow definition.
   *
   * Validates:
   * - Entry node exists and is registered
   * - At least one terminal node exists
   * - All edge sources/targets reference registered nodes
   * - No orphan nodes (unreachable with optional strict mode)
   */
  build(strict = false): WorkflowDefinition {
    this.validate();
    if (strict) this.validateReachability();

    return {
      id: this.id,
      name: this.name ?? this.id,
      description: this.description,
      version: this.version,
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      entryNode: this.entryNode!,
      terminalNodes: Array.from(this.terminalNodes),
      initialState: { ...this.initialState },
    };
  }

  private validate(): void {
    if (!this.entryNode) {
      throw new Error(`Workflow "${this.id}": no entry node set. Call .withEntry().`);
    }
    if (!this.nodes.has(this.entryNode)) {
      throw new Error(
        `Workflow "${this.id}": entry node "${this.entryNode}" is not a registered node.`,
      );
    }
    if (this.terminalNodes.size === 0) {
      throw new Error(
        `Workflow "${this.id}": no terminal nodes set. Call .withTerminal().`,
      );
    }
    for (const node of this.terminalNodes) {
      if (!this.nodes.has(node)) {
        throw new Error(
          `Workflow "${this.id}": terminal node "${node}" is not a registered node.`,
        );
      }
    }
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) {
        throw new Error(
          `Workflow "${this.id}": edge "${edge.id}" references unknown source node "${edge.from}".`,
        );
      }
      if (!this.nodes.has(edge.to)) {
        throw new Error(
          `Workflow "${this.id}": edge "${edge.id}" references unknown target node "${edge.to}".`,
        );
      }
    }
  }

  private validateReachability(): void {
    // BFS from entry to check all nodes are reachable
    const visited = new Set<NodeId>();
    const queue = [this.entryNode!];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of this.edges) {
        if (edge.from === current) queue.push(edge.to);
      }
    }

    // Check if any terminal is reachable
    const terminalArr = Array.from(this.terminalNodes);
    const reachableTerminals = terminalArr.filter((t) =>
      visited.has(t),
    );
    if (reachableTerminals.length === 0) {
      throw new Error(
        `Workflow "${this.id}": no terminal nodes are reachable from the entry node.`,
      );
    }
  }
}
