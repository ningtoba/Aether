/**
 * Dynamic graph editor for Aether workflows.
 *
 * Allows programmatic mutation of workflow graphs at runtime — adding,
 * removing, or modifying nodes and edges. Useful for dynamic graph
 * editing and GUI-based graph management in the Electron frontend.
 *
 * @module @aether/orchestrator
 */

import type { WorkflowDefinition, NodeDefinition, EdgeDefinition, NodeId } from './types.js';

// ─── Edit operations ───────────────────────────────────────

/** Result of a graph edit operation */
export interface GraphEditResult {
  success: boolean;
  workflow: WorkflowDefinition;
  error?: string;
}

/** A single edit operation to apply to a workflow graph */
export type GraphEdit =
  | AddNodeEdit
  | RemoveNodeEdit
  | UpdateNodeEdit
  | AddEdgeEdit
  | RemoveEdgeEdit
  | UpdateEdgeEdit
  | SetEntryEdit
  | AddTerminalEdit
  | RemoveTerminalEdit;

export interface AddNodeEdit {
  type: 'add-node';
  node: NodeDefinition;
}

export interface RemoveNodeEdit {
  type: 'remove-node';
  nodeId: string;
}

export interface UpdateNodeEdit {
  type: 'update-node';
  nodeId: string;
  patch: Partial<NodeDefinition>;
}

export interface AddEdgeEdit {
  type: 'add-edge';
  edge: EdgeDefinition;
}

export interface RemoveEdgeEdit {
  type: 'remove-edge';
  edgeId: string;
}

export interface UpdateEdgeEdit {
  type: 'update-edge';
  edgeId: string;
  patch: Partial<EdgeDefinition>;
}

export interface SetEntryEdit {
  type: 'set-entry';
  nodeId: string;
}

export interface AddTerminalEdit {
  type: 'add-terminal';
  nodeId: string;
}

export interface RemoveTerminalEdit {
  type: 'remove-terminal';
  nodeId: string;
}

// ─── Editor class ───────────────────────────────────────────

/**
 * Mutable workflow graph editor.
 *
 * Applies validated edit operations to a WorkflowDefinition,
 * producing a new (mutated) definition each time.
 */

export class GraphEditor {
  private workflow: WorkflowDefinition;

  constructor(workflow: WorkflowDefinition) {
    // Deep clone to avoid mutating the original
    this.workflow = JSON.parse(JSON.stringify(workflow));
  }

  /**
   * Get the current workflow definition.
   */
  getDefinition(): WorkflowDefinition {
    return JSON.parse(JSON.stringify(this.workflow));
  }

  /**
   * Apply a single edit operation.
   */
  edit(edit: GraphEdit): GraphEditResult {
    try {
      switch (edit.type) {
        case 'add-node':
          return this.addNode(edit);
        case 'remove-node':
          return this.removeNode(edit);
        case 'update-node':
          return this.updateNode(edit);
        case 'add-edge':
          return this.addEdge(edit);
        case 'remove-edge':
          return this.removeEdge(edit);
        case 'update-edge':
          return this.updateEdge(edit);
        case 'set-entry':
          return this.setEntry(edit);
        case 'add-terminal':
          return this.addTerminal(edit);
        case 'remove-terminal':
          return this.removeTerminal(edit);
        default:
          return {
            success: false,
            workflow: this.workflow,
            error: `Unknown edit type: ${(edit as any).type}`,
          };
      }
    } catch (err) {
      return {
        success: false,
        workflow: this.workflow,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Apply multiple edits in sequence.
   */
  editBatch(edits: GraphEdit[]): GraphEditResult {
    for (const edit of edits) {
      const result = this.edit(edit);
      if (!result.success) {
        return result; // Stop on first failure
      }
    }
    return { success: true, workflow: this.workflow };
  }

  /**
   * Get the full graph as a JSON-serializable object.
   */
  toJSON(): WorkflowDefinition {
    return this.workflow;
  }

  /**
   * Validate the current graph state.
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check entry node exists
    if (!this.workflow.entryNode) {
      errors.push('No entry node defined');
    } else if (!this.workflow.nodes.some((n) => n.id === this.workflow.entryNode)) {
      errors.push(`Entry node "${this.workflow.entryNode}" does not exist`);
    }

    // Check at least one terminal node
    if (this.workflow.terminalNodes.length === 0) {
      errors.push('No terminal nodes defined');
    }

    // Check all terminal nodes exist
    for (const terminalId of this.workflow.terminalNodes) {
      if (!this.workflow.nodes.some((n) => n.id === terminalId)) {
        errors.push(`Terminal node "${terminalId}" does not exist`);
      }
    }

    // Check all edge references are valid
    for (const edge of this.workflow.edges) {
      if (!this.workflow.nodes.some((n) => n.id === edge.from)) {
        errors.push(`Edge "${edge.id}" references unknown source node "${edge.from}"`);
      }
      // Accept registered nodes, terminals, and the symbolic end sentinels the
      // builder allows ('END'/'__end__'). The previous `find(() => true)` clause
      // was inert and is gone.
      const targetIsKnown =
        this.workflow.nodes.some((n) => n.id === edge.to) ||
        this.workflow.terminalNodes.includes(edge.to) ||
        edge.to === 'END' ||
        edge.to === '__end__';
      if (!targetIsKnown) {
        errors.push(`Edge "${edge.id}" references unknown target node "${edge.to}"`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ── Private operations ─────────────────────────────────

  private addNode(edit: AddNodeEdit): GraphEditResult {
    if (this.workflow.nodes.some((n) => n.id === edit.node.id)) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.node.id}" already exists`,
      };
    }
    this.workflow.nodes.push(edit.node);
    return { success: true, workflow: this.workflow };
  }

  private removeNode(edit: RemoveNodeEdit): GraphEditResult {
    const idx = this.workflow.nodes.findIndex((n) => n.id === edit.nodeId);
    if (idx === -1) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.nodeId}" not found`,
      };
    }

    // Remove all edges referencing this node
    this.workflow.edges = this.workflow.edges.filter(
      (e) => e.from !== edit.nodeId && e.to !== edit.nodeId,
    );

    // Remove from nodes array
    this.workflow.nodes.splice(idx, 1);

    // Clean up entry/terminal references
    if (this.workflow.entryNode === edit.nodeId) {
      this.workflow.entryNode = this.workflow.nodes[0]?.id ?? '';
    }
    this.workflow.terminalNodes = this.workflow.terminalNodes.filter((id) => id !== edit.nodeId);

    return { success: true, workflow: this.workflow };
  }

  private updateNode(edit: UpdateNodeEdit): GraphEditResult {
    const node = this.workflow.nodes.find((n) => n.id === edit.nodeId);
    if (!node) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.nodeId}" not found`,
      };
    }
    if ('id' in edit.patch) {
      return {
        success: false,
        workflow: this.workflow,
        error: 'Node id cannot be changed via update-node (edges and entry/terminal would orphan)',
      };
    }
    Object.assign(node, edit.patch);
    return { success: true, workflow: this.workflow };
  }

  private addEdge(edit: AddEdgeEdit): GraphEditResult {
    const edge = edit.edge;
    if (this.workflow.edges.some((e) => e.id === edge.id)) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Edge "${edge.id}" already exists`,
      };
    }
    this.workflow.edges.push(edge);
    return { success: true, workflow: this.workflow };
  }

  private removeEdge(edit: RemoveEdgeEdit): GraphEditResult {
    const idx = this.workflow.edges.findIndex((e) => e.id === edit.edgeId);
    if (idx === -1) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Edge "${edit.edgeId}" not found`,
      };
    }
    this.workflow.edges.splice(idx, 1);
    return { success: true, workflow: this.workflow };
  }

  private updateEdge(edit: UpdateEdgeEdit): GraphEditResult {
    const edge = this.workflow.edges.find((e) => e.id === edit.edgeId);
    if (!edge) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Edge "${edit.edgeId}" not found`,
      };
    }
    if ('id' in edit.patch) {
      return {
        success: false,
        workflow: this.workflow,
        error: 'Edge id cannot be changed via update-edge',
      };
    }
    Object.assign(edge, edit.patch);
    return { success: true, workflow: this.workflow };
  }

  private setEntry(edit: SetEntryEdit): GraphEditResult {
    if (!this.workflow.nodes.some((n) => n.id === edit.nodeId)) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.nodeId}" not found`,
      };
    }
    this.workflow.entryNode = edit.nodeId;
    return { success: true, workflow: this.workflow };
  }

  private addTerminal(edit: AddTerminalEdit): GraphEditResult {
    if (!this.workflow.nodes.some((n) => n.id === edit.nodeId)) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.nodeId}" not found`,
      };
    }
    if (this.workflow.terminalNodes.includes(edit.nodeId)) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.nodeId}" is already a terminal`,
      };
    }
    this.workflow.terminalNodes.push(edit.nodeId);
    return { success: true, workflow: this.workflow };
  }

  private removeTerminal(edit: RemoveTerminalEdit): GraphEditResult {
    const idx = this.workflow.terminalNodes.indexOf(edit.nodeId);
    if (idx === -1) {
      return {
        success: false,
        workflow: this.workflow,
        error: `Node "${edit.nodeId}" is not a terminal`,
      };
    }
    this.workflow.terminalNodes.splice(idx, 1);
    return { success: true, workflow: this.workflow };
  }
}
