/**
 * Graph visualization for Aether workflows.
 *
 * Generates Mermaid.js diagram strings and DOT (Graphviz) output
 * from WorkflowDefinitions for visualization in the UI or CLI.
 *
 * @module @aether/orchestrator
 */

import type { WorkflowDefinition, NodeDefinition, EdgeDefinition } from "./types.js";

// ─── Mermaid.js ─────────────────────────────────────────────

/**
 * Generate a Mermaid.js flowchart from a WorkflowDefinition.
 *
 * @returns A Mermaid flowchart string that can be rendered in the UI.
 */
export function toMermaid(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push("flowchart TD");
  lines.push(`  %% Workflow: ${workflow.name} (v${workflow.version})`);
  lines.push("");

  // Add node definitions
  for (const node of workflow.nodes) {
    const label = escapeMermaid(node.label ?? node.id);
    const kindIcon = getKindIcon(node.kind);
    lines.push(`  ${node.id}["${kindIcon} ${label}"]`);
  }

  lines.push("");

  // Style entry and terminal nodes
  const entryNode = workflow.entryNode;
  for (const node of workflow.nodes) {
    if (node.id === entryNode) {
      lines.push(`  style ${node.id} fill:#1a73e8,color:#fff,stroke:#0d47a1`);
    }
    if (workflow.terminalNodes.includes(node.id)) {
      lines.push(`  style ${node.id} fill:#2e7d32,color:#fff,stroke:#1b5e20`);
    }
  }

  lines.push("");

  // Add edges
  for (const edge of workflow.edges) {
    const label = edge.label ?? getEdgeLabel(edge);
    if (edge.kind === "direct") {
      lines.push(`  ${edge.from} -->|"${escapeMermaid(label)}"| ${edge.to};`);
    } else if (edge.kind === "conditional") {
      const condStr = edge.conditions
        ?.map((c) => `${c.field} ${c.operator} ${c.value}`)
        .join(", ");
      lines.push(
        `  ${edge.from} --o|"${escapeMermaid(label)}"| ${edge.to};`,
      );
      if (condStr) {
        lines.push(`  linkStyle default stroke:#f9a825,stroke-width:2px`);
      }
    } else if (edge.kind === "llm-route") {
      lines.push(`  ${edge.from} ==o|"${escapeMermaid(label)}"| ${edge.to};`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a Mermaid.js sequence diagram for an executed workflow.
 */
export function toMermaidSequence(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push("sequenceDiagram");
  lines.push(`  %% Workflow: ${workflow.name}`);
  lines.push("");

  // Participants
  for (const node of workflow.nodes) {
    const label = escapeMermaid(node.label ?? node.id);
    lines.push(`  participant "${label}" as ${node.id}`);
  }

  lines.push("");

  // Messages along edges
  for (const edge of workflow.edges) {
    const label = edge.label ?? getEdgeLabel(edge);
    lines.push(`  ${edge.from}->>+${edge.to}: ${escapeMermaid(label)}`);
    lines.push(`  ${edge.to}-->>-${edge.from}: done`);
  }

  return lines.join("\n");
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
  lines.push("");

  // Entry node styling
  if (workflow.entryNode) {
    lines.push(`  "${workflow.entryNode}" [shape=oval, style=filled, fillcolor="#1a73e8", fontcolor=white];`);
  }

  // Terminal node styling
  for (const terminalId of workflow.terminalNodes) {
    lines.push(`  "${terminalId}" [shape=doublecircle, style=filled, fillcolor="#2e7d32", fontcolor=white];`);
  }

  lines.push("");

  // Edges
  for (const edge of workflow.edges) {
    const label = edge.label ?? getEdgeLabel(edge);
    if (edge.kind === "conditional") {
      lines.push(`  "${edge.from}" -> "${edge.to}" [label="${escapeDOT(label)}", style=dashed, color="#f9a825"];`);
    } else {
      lines.push(`  "${edge.from}" -> "${edge.to}" [label="${escapeDOT(label)}"];`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ─── Node-level breakdown ───────────────────────────────────

/**
 * Generate a text-based tree of the workflow graph.
 */
export function toTextTree(workflow: WorkflowDefinition): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${workflow.name} (${workflow.id}) v${workflow.version}`);
  if (workflow.description) lines.push(`Description: ${workflow.description}`);
  lines.push("");

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
    const prefix = "  ".repeat(depth);
    const kind = node ? `[${node.kind}]` : "[?]";
    const label = node?.label ?? id;
    const terminal = workflow.terminalNodes.includes(id) ? " (terminal)" : "";
    lines.push(`${prefix}${depth > 0 ? "-> " : ""}${label} ${kind}${terminal}`);

    const edges = adjacency.get(id) ?? [];
    for (const edge of edges) {
      if (!visited.has(edge.to)) {
        queue.push({ id: edge.to, depth: depth + 1 });
      }
    }
  }

  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────

function escapeMermaid(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/\n/g, "\\n");
}

function escapeDOT(text: string): string {
  return text
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\\/g, "\\\\");
}

function getKindIcon(kind: string): string {
  switch (kind) {
    case "agent": return "\u{1F916}"; // robot
    case "tool": return "\u{1F527}"; // wrench
    case "router": return "\u{1F9F0}"; // puzzle piece
    case "map": return "\u{1F500}"; // repeat
    case "reduce": return "\u{1F4CA}"; // bar chart
    case "subgraph": return "\u{1F5C2}"; // folder
    case "sleep": return "\u{23F0}"; // alarm clock
    case "signal": return "\u{1F6AB}"; // no entry
    default: return "\u{25CF}"; // circle
  }
}

function getEdgeLabel(edge: EdgeDefinition): string {
  switch (edge.kind) {
    case "direct": return "pass";
    case "conditional": return edge.conditions?.map((c) => `${c.field} ${c.operator} ${c.value}`).join(" & ") ?? "if";
    case "llm-route": return "llm route";
    default: return "edge";
  }
}
