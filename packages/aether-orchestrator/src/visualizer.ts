/**
 * Graph visualization for Aether workflows.
 *
 * Generates Mermaid.js diagram strings and DOT (Graphviz) output
 * from WorkflowDefinitions for visualization in the UI or CLI.
 *
 * @module @aether/orchestrator
 */

import type { WorkflowDefinition, NodeDefinition, EdgeDefinition } from './types.js';

// ─── Mermaid.js ─────────────────────────────────────────────

/**
 * Generate a Mermaid.js flowchart from a WorkflowDefinition.
 *
 * @returns A Mermaid flowchart string that can be rendered in the UI.
 */
export function toMermaid(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push('flowchart TD');
  lines.push(`  %% Workflow: ${oneLine(workflow.name)} (v${workflow.version})`);
  lines.push('');

  // Add node definitions
  for (const node of workflow.nodes) {
    const label = escapeMermaid(node.label ?? node.id);
    const kindIcon = getKindIcon(node.kind);
    lines.push(`  ${quoteId(node.id)}["${kindIcon} ${label}"]`);
  }

  lines.push('');

  // Style entry and terminal nodes (one merged style when a node is both)
  const entryNode = workflow.entryNode;
  for (const node of workflow.nodes) {
    const isEntry = node.id === entryNode;
    const isTerminal = workflow.terminalNodes.includes(node.id);
    if (isEntry && isTerminal) {
      lines.push(`  style ${quoteId(node.id)} fill:#1b5e20,color:#fff,stroke:#0d47a1`);
    } else if (isEntry) {
      lines.push(`  style ${quoteId(node.id)} fill:#1a73e8,color:#fff,stroke:#0d47a1`);
    } else if (isTerminal) {
      lines.push(`  style ${quoteId(node.id)} fill:#2e7d32,color:#fff,stroke:#1b5e20`);
    }
  }

  lines.push('');

  // Add edges
  let edgeIndex = 0;
  for (const edge of workflow.edges) {
    const label = edge.label ?? getEdgeLabel(edge);
    if (edge.kind === 'direct') {
      lines.push(`  ${quoteId(edge.from)} -->|"${escapeMermaid(label)}"| ${quoteId(edge.to)};`);
    } else if (edge.kind === 'conditional') {
      lines.push(`  ${quoteId(edge.from)} --o|"${escapeMermaid(label)}"| ${quoteId(edge.to)};`);
      // Highlight only THIS edge, not every edge in the diagram.
      lines.push(`  linkStyle ${edgeIndex} stroke:#f9a825,stroke-width:2px`);
    } else if (edge.kind === 'llm-route') {
      // `==>` is a standard Mermaid thick edge (the old `==o` was not).
      lines.push(`  ${quoteId(edge.from)} ==>|"${escapeMermaid(label)}"| ${quoteId(edge.to)};`);
    }
    edgeIndex++;
  }

  return lines.join('\n');
}

/**
 * Generate a Mermaid.js sequence diagram for an executed workflow.
 */
export function toMermaidSequence(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push('sequenceDiagram');
  lines.push(`  %% Workflow: ${oneLine(workflow.name)}`);
  lines.push('');

  // Participants
  for (const node of workflow.nodes) {
    const label = escapeMermaid(node.label ?? node.id);
    lines.push(`  participant "${label}" as ${mermaidAlias(node.id)}`);
  }

  lines.push('');

  // Messages along edges
  for (const edge of workflow.edges) {
    const label = edge.label ?? getEdgeLabel(edge);
    lines.push(`  ${mermaidAlias(edge.from)}->>+${mermaidAlias(edge.to)}: ${escapeMermaid(label)}`);
    lines.push(`  ${mermaidAlias(edge.to)}-->>-${mermaidAlias(edge.from)}: done`);
  }

  return lines.join('\n');
}

// ─── Graphviz DOT ───────────────────────────────────────────

/**
 * Generate a Graphviz DOT string from a WorkflowDefinition.
 */
export function toDOT(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`digraph "${escapeDOT(workflow.name)}" {`);
  lines.push(`  rankdir=TB;`);
  lines.push(`  label="${escapeDOT(workflow.name)} v${workflow.version}";`);
  lines.push(`  fontsize=14;`);
  lines.push(`  node [fontsize=12, shape=box, style=rounded];`);
  lines.push('');

  // Declare every node so isolated nodes are not silently dropped from output.
  for (const node of workflow.nodes) {
    lines.push(`  "${escapeDOT(node.id)}";`);
  }

  // Entry node styling
  if (workflow.entryNode) {
    lines.push(
      `  "${escapeDOT(workflow.entryNode)}" [shape=oval, style=filled, fillcolor="#1a73e8", fontcolor=white];`,
    );
  }

  // Terminal node styling
  for (const terminalId of workflow.terminalNodes) {
    lines.push(
      `  "${escapeDOT(terminalId)}" [shape=doublecircle, style=filled, fillcolor="#2e7d32", fontcolor=white];`,
    );
  }

  lines.push('');

  // Edges
  for (const edge of workflow.edges) {
    const label = edge.label ?? getEdgeLabel(edge);
    if (edge.kind === 'conditional') {
      lines.push(
        `  "${escapeDOT(edge.from)}" -> "${escapeDOT(edge.to)}" [label="${escapeDOT(label)}", style=dashed, color="#f9a825"];`,
      );
    } else if (edge.kind === 'llm-route') {
      lines.push(
        `  "${escapeDOT(edge.from)}" -> "${escapeDOT(edge.to)}" [label="${escapeDOT(label)}", style=dotted, color="#8e24aa"];`,
      );
    } else {
      lines.push(
        `  "${escapeDOT(edge.from)}" -> "${escapeDOT(edge.to)}" [label="${escapeDOT(label)}"];`,
      );
    }
  }

  lines.push('}');
  return lines.join('\n');
}

// ─── Node-level breakdown ───────────────────────────────────

/**
 * Generate a text-based tree of the workflow graph.
 */
export function toTextTree(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${oneLine(workflow.name)} (${workflow.id}) v${workflow.version}`);
  if (workflow.description) lines.push(`Description: ${oneLine(workflow.description)}`);
  lines.push('');

  if (!workflow.entryNode) {
    lines.push('(no entry node)');
    return lines.join('\n');
  }

  // Build adjacency
  const adjacency = new Map<string, EdgeDefinition[]>();
  for (const edge of workflow.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }

  // BFS from entry
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: workflow.entryNode, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = workflow.nodes.find((n) => n.id === id);
    const prefix = '  '.repeat(depth);
    const kind = node ? `[${node.kind}]` : '[?]';
    const label = node?.label ?? id;
    const terminal = workflow.terminalNodes.includes(id) ? ' (terminal)' : '';
    lines.push(`${prefix}${depth > 0 ? '-> ' : ''}${oneLine(label)} ${kind}${terminal}`);

    const edges = adjacency.get(id) ?? [];
    for (const edge of edges) {
      // The symbolic end sentinels are terminals, not nodes — render them as
      // leaf markers instead of fabricating an "[?]" node.
      if (edge.to === 'END' || edge.to === '__end__') {
        lines.push(`${prefix}  -> END (end)`);
        continue;
      }
      if (!visited.has(edge.to)) {
        queue.push({ id: edge.to, depth: depth + 1 });
      }
    }
  }

  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────

function escapeMermaid(text: string): string {
  return text.replace(/"/g, '#quot;').replace(/\n/g, '\\n');
}

/** Quote a node/edge id (which may be an arbitrary user string) for Mermaid. */
function quoteId(id: string): string {
  return `"${escapeMermaid(id)}"`;
}

/** Sanitize an arbitrary node id into a Mermaid sequence participant alias. */
function mermaidAlias(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Collapse newlines so a value cannot break out of a single line. */
function oneLine(text: string): string {
  return text.replace(/\r?\n/g, ' ');
}

function escapeDOT(text: string): string {
  // Backslashes FIRST so the backslashes the quote pass inserts are not
  // re-doubled into invalid escape sequences by a later pass.
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function getKindIcon(kind: string): string {
  switch (kind) {
    case 'agent':
      return '\u{1F916}'; // robot
    case 'tool':
      return '\u{1F527}'; // wrench
    case 'router':
      return '\u{1F9F0}'; // puzzle piece
    case 'map':
      return '\u{1F500}'; // repeat
    case 'reduce':
      return '\u{1F4CA}'; // bar chart
    case 'subgraph':
      return '\u{1F5C2}'; // folder
    case 'sleep':
      return '\u{23F0}'; // alarm clock
    case 'signal':
      return '\u{1F6AB}'; // no entry
    default:
      return '\u{25CF}'; // circle
  }
}

function getEdgeLabel(edge: EdgeDefinition): string {
  switch (edge.kind) {
    case 'direct':
      return 'pass';
    case 'conditional':
      return edge.conditions?.map((c) => `${c.field} ${c.operator} ${c.value}`).join(' & ') ?? 'if';
    case 'llm-route':
      return 'llm route';
    default:
      return 'edge';
  }
}
