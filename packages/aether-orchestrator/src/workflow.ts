import type {
  WorkflowDefinition,
  NodeDefinition,
  EdgeDefinition,
} from "./types.js";

/**
 * Fluent builder for constructing WorkflowDefinitions.
 *
 * Provides a chainable API to add nodes, edges, and configure
 * entry/end points before calling `build()` to produce the
 * final definition.
 */
export class WorkflowBuilder {
  private name = "";
  private description = "";
  private nodes: NodeDefinition[] = [];
  private edges: EdgeDefinition[] = [];
  private entryPoint = "";
  private endPoint = "";
  private stateSchema: Record<string, unknown> = {};

  /**
   * Set the workflow name.
   */
  setName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Set the workflow description.
   */
  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Add a node to the workflow graph.
   */
  addNode(node: NodeDefinition): this {
    this.nodes.push(node);
    return this;
  }

  /**
   * Add a directed edge between two nodes.
   */
  addEdge(edge: EdgeDefinition): this {
    this.edges.push(edge);
    return this;
  }

  /**
   * Set the entry-point node id.
   */
  setEntryPoint(id: string): this {
    this.entryPoint = id;
    return this;
  }

  /**
   * Set the end / terminal node id.
   */
  setEndPoint(id: string): this {
    this.endPoint = id;
    return this;
  }

  /**
   * Set the JSON Schema-like state shape for the workflow.
   */
  setStateSchema(schema: Record<string, unknown>): this {
    this.stateSchema = schema;
    return this;
  }

  /**
   * Build and return the final WorkflowDefinition.
   *
   * Throws if required fields (name, entryPoint, endPoint) are missing
   * or if no nodes or edges have been defined.
   */
  build(): WorkflowDefinition {
    if (!this.name) throw new Error("Workflow name is required");
    if (!this.entryPoint) throw new Error("Entry point is required");
    if (!this.endPoint) throw new Error("End point is required");
    if (this.nodes.length === 0) throw new Error("At least one node is required");
    if (this.edges.length === 0) throw new Error("At least one edge is required");

    return {
      name: this.name,
      description: this.description,
      nodes: [...this.nodes],
      edges: [...this.edges],
      entryPoint: this.entryPoint,
      endPoint: this.endPoint,
      stateSchema: { ...this.stateSchema },
    };
  }
}
