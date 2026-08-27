import React, { useState, useMemo, useCallback } from "react";
import type {
  WorkflowDefinition,
  NodeDefinition,
  EdgeDefinition,
  NodeKind,
} from "@aether/orchestrator";

// ─── Sample Data ──────────────────────────────────────────────
// In a real app, these would come from an IPC call or store.
// We include rich sample data so the UI is demonstrable immediately.

const SAMPLE_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "wf-research",
    name: "Research Pipeline",
    description: "Multi-step research: fetch, analyze, summarize, and store findings.",
    version: "1.2.0",
    entryNode: "start",
    terminalNodes: ["store"],
    initialState: { topic: { type: "string", required: true } },
    nodes: [
      { id: "start", kind: "agent", label: "Research Planner", agentName: "planner", timeout: 30000 },
      { id: "fetch", kind: "tool", label: "Web Fetcher", toolName: "web_search", timeout: 60000 },
      { id: "analyze", kind: "agent", label: "Content Analyzer", agentName: "analyzer", timeout: 45000 },
      { id: "router", kind: "router", label: "Relevance Router", timeout: 10000 },
      { id: "deep", kind: "agent", label: "Deep Dive", agentName: "deep_diver", timeout: 90000 },
      { id: "summarize", kind: "agent", label: "Summarizer", agentName: "summarizer", timeout: 30000 },
      { id: "store", kind: "tool", label: "Knowledge Store", toolName: "vector_store", timeout: 20000 },
    ],
    edges: [
      { id: "e-start-fetch", from: "start", to: "fetch", kind: "direct", label: "search" },
      { id: "e-fetch-analyze", from: "fetch", to: "analyze", kind: "direct", label: "raw content" },
      { id: "e-analyze-router", from: "analyze", to: "router", kind: "direct", label: "analysis" },
      {
        id: "e-router-deep", from: "router", to: "deep", kind: "conditional",
        label: "needs deeper analysis",
        conditions: [{ field: "relevance_score", operator: "gte", value: 8 }],
      },
      {
        id: "e-router-summarize", from: "router", to: "summarize", kind: "conditional",
        label: "enough context",
        conditions: [{ field: "relevance_score", operator: "lt", value: 8 }],
      },
      { id: "e-deep-summarize", from: "deep", to: "summarize", kind: "direct", label: "deep content" },
      { id: "e-summarize-store", from: "summarize", to: "store", kind: "direct", label: "save" },
    ],
  },
  {
    id: "wf-customer-support",
    name: "Customer Support Agent",
    description: "Handle customer tickets with triage, escalation, and resolution.",
    version: "2.0.1",
    entryNode: "triage",
    terminalNodes: ["resolve", "escalate_human"],
    initialState: { message: { type: "string", required: true } },
    nodes: [
      { id: "triage", kind: "router", label: "Ticket Triage", timeout: 5000 },
      { id: "faq", kind: "agent", label: "FAQ Bot", agentName: "faq_bot", timeout: 15000, retry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 2000, backoffFactor: 2, retryableErrors: ["Timeout"] } },
      { id: "billing", kind: "agent", label: "Billing Agent", agentName: "billing_agent", timeout: 30000 },
      { id: "tech", kind: "agent", label: "Technical Support", agentName: "tech_support", timeout: 60000 },
      { id: "resolve", kind: "tool", label: "Resolution Logger", toolName: "ticket_logger", timeout: 5000 },
      { id: "escalate_human", kind: "signal", label: "Escalate to Human", timeout: 0, description: "Waits for human agent to pick up" },
    ],
    edges: [
      { id: "e-triage-faq", from: "triage", to: "faq", kind: "conditional", label: "faq", conditions: [{ field: "category", operator: "eq", value: "faq" }] },
      { id: "e-triage-billing", from: "triage", to: "billing", kind: "conditional", label: "billing", conditions: [{ field: "category", operator: "eq", value: "billing" }] },
      { id: "e-triage-tech", from: "triage", to: "tech", kind: "conditional", label: "tech", conditions: [{ field: "category", operator: "eq", value: "tech" }] },
      { id: "e-faq-resolve", from: "faq", to: "resolve", kind: "direct", label: "resolved" },
      { id: "e-billing-resolve", from: "billing", to: "resolve", kind: "direct", label: "resolved" },
      { id: "e-tech-resolve", from: "tech", to: "resolve", kind: "direct", label: "resolved" },
      { id: "e-triage-escalate", from: "triage", to: "escalate_human", kind: "direct", label: "escalate" },
    ],
  },
  {
    id: "wf-data-pipeline",
    name: "Data Pipeline",
    description: "ETL pipeline: extract, transform, load with parallel map-reduce.",
    version: "1.0.0",
    entryNode: "extract",
    terminalNodes: ["load"],
    initialState: { source: { type: "string", required: true } },
    nodes: [
      { id: "extract", kind: "tool", label: "Data Extractor", toolName: "extractor", timeout: 60000 },
      { id: "validate", kind: "agent", label: "Validation Agent", agentName: "validator", timeout: 30000, onError: "retry" },
      { id: "parallel_process", kind: "map", label: "Parallel Processor", timeout: 120000, description: "Fan-out to multiple transform workers" },
      { id: "transform_a", kind: "tool", label: "Transform A", toolName: "transform_a" },
      { id: "transform_b", kind: "tool", label: "Transform B", toolName: "transform_b" },
      { id: "merge", kind: "reduce", label: "Merge Results", timeout: 30000 },
      { id: "load", kind: "tool", label: "Data Loader", toolName: "db_writer", timeout: 30000 },
    ],
    edges: [
      { id: "e-extract-validate", from: "extract", to: "validate", kind: "direct", label: "raw data" },
      { id: "e-validate-parallel", from: "validate", to: "parallel_process", kind: "direct", label: "validated" },
      { id: "e-parallel-a", from: "parallel_process", to: "transform_a", kind: "direct", label: "worker A" },
      { id: "e-parallel-b", from: "parallel_process", to: "transform_b", kind: "direct", label: "worker B" },
      { id: "e-a-merge", from: "transform_a", to: "merge", kind: "direct", label: "result A" },
      { id: "e-b-merge", from: "transform_b", to: "merge", kind: "direct", label: "result B" },
      { id: "e-merge-load", from: "merge", to: "load", kind: "direct", label: "merged data" },
    ],
  },
  {
    id: "wf-draft-agent",
    name: "Draft Agent Blueprint",
    description: "Experimental agent workflow — still in design.",
    version: "0.2.0",
    entryNode: "input",
    terminalNodes: ["output"],
    initialState: { prompt: { type: "string", required: true } },
    nodes: [
      { id: "input", kind: "signal", label: "User Input", description: "Receives prompt via API" },
      { id: "think", kind: "agent", label: "Reasoning Engine", agentName: "reasoner", timeout: 60000 },
      { id: "output", kind: "agent", label: "Response Generator", agentName: "generator", timeout: 30000 },
    ],
    edges: [
      { id: "e-input-think", from: "input", to: "think", kind: "direct", label: "prompt" },
      { id: "e-think-output", from: "think", to: "output", kind: "direct", label: "reasoning" },
    ],
  },
];

// ─── Status Map ───────────────────────────────────────────────
type WorkflowStatus = "active" | "draft" | "archived";
function inferStatus(wf: WorkflowDefinition): WorkflowStatus {
  const v = wf.version;
  if (v.startsWith("0.")) return "draft";
  if (v.startsWith("1.")) return "active";
  return "archived";
}

// ─── Node Kind Colors ─────────────────────────────────────────
const NODE_COLORS: Record<NodeKind, string> = {
  agent: "#3b82f6",
  tool: "#22c55e",
  router: "#f59e0b",
  map: "#8b5cf6",
  reduce: "#ec4899",
  subgraph: "#06b6d4",
  sleep: "#6b7280",
  signal: "#ef4444",
};

const NODE_GLYPH: Record<NodeKind, string> = {
  agent: "A",
  tool: "T",
  router: "R",
  map: "M",
  reduce: "V",
  subgraph: "S",
  sleep: "Z",
  signal: "!",
};

// ─── Helper: Layered DAG Layout ───────────────────────────────
interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function computeLayout(wf: WorkflowDefinition): Map<string, LayoutNode> {
  const nodeW = 160;
  const nodeH = 56;
  const gapX = 60;
  const gapY = 36; // vertical gap between rows
  const marginL = 20;
  const marginT = 8;

  // Topological sort by BFS layers
  const incoming = new Map<string, number>();
  for (const n of wf.nodes) incoming.set(n.id, 0);
  for (const e of wf.edges) {
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }

  // Layer 0 = entry node, then progressively
  const layers = new Map<string, number>(); // nodeId -> layer
  const queue: string[] = [wf.entryNode];
  layers.set(wf.entryNode, 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layers.get(cur)!;
    const children = wf.edges.filter((e) => e.from === cur);
    for (const child of children) {
      const existing = layers.get(child.to);
      const newLayer = curLayer + 1;
      if (existing === undefined || newLayer > existing) {
        layers.set(child.to, newLayer);
      }
      // Only add to queue if we haven't visited or found a deeper path
      if (existing === undefined || newLayer > existing) {
        queue.push(child.to);
      }
    }
  }

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    const group = layerGroups.get(layer) ?? [];
    group.push(id);
    layerGroups.set(layer, group);
  }

  // Compute positions
  const layout = new Map<string, LayoutNode>();
  const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

  for (const layer of sortedLayers) {
    const nodes = layerGroups.get(layer)!;

    // Within each layer, space nodes vertically
    const nodeCount = nodes.length;
    const totalH = nodeCount * nodeH + (nodeCount - 1) * gapY;
    const startY = marginT + (300 - totalH) / 2; // center vertically in a ~300px band

    for (let i = 0; i < nodeCount; i++) {
      const id = nodes[i];
      const x = marginL + layer * (nodeW + gapX);
      const y = startY + i * (nodeH + gapY);
      layout.set(id, { id, x, y, w: nodeW, h: nodeH });
    }
  }

  return layout;
}

// ─── Sub-Components ───────────────────────────────────────────

function NodeBox({
  node,
  layout,
  isEntry,
  isTerminal,
  selected,
  onClick,
}: {
  node: NodeDefinition;
  layout: LayoutNode;
  isEntry: boolean;
  isTerminal: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const color = NODE_COLORS[node.kind] ?? "#6b7280";
  const glyph = NODE_GLYPH[node.kind] ?? "?";

  return (
    <g
      onClick={onClick}
      style={{ cursor: "pointer" }}
    >
      {/* Entry badge */}
      {isEntry && (
        <rect
          x={layout.x - 4}
          y={layout.y - 16}
          width={layout.w + 8}
          height={layout.h + 20}
          rx={8}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
      {/* Main box */}
      <rect
        x={layout.x}
        y={layout.y}
        width={layout.w}
        height={layout.h}
        rx={6}
        fill={selected ? `${color}30` : "#1e1e24"}
        stroke={selected ? color : isEntry ? "#3b82f6" : isTerminal ? "#22c55e" : "#2a2a33"}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {/* Glyph */}
      <rect
        x={layout.x + 6}
        y={layout.y + 12}
        width={28}
        height={32}
        rx={4}
        fill={`${color}22`}
        stroke={color}
        strokeWidth={1.5}
      />
      <text
        x={layout.x + 20}
        y={layout.y + 33}
        textAnchor="middle"
        fill={color}
        fontSize={14}
        fontWeight={700}
        fontFamily="monospace"
      >
        {glyph}
      </text>
      {/* Label */}
      <text
        x={layout.x + 44}
        y={layout.y + 22}
        fill="#e5e7eb"
        fontSize={12}
        fontWeight={500}
        fontFamily="sans-serif"
      >
        {node.label ?? node.id}
      </text>
      <text
        x={layout.x + 44}
        y={layout.y + 40}
        fill="#6b7280"
        fontSize={10}
        fontFamily="sans-serif"
      >
        {node.kind}{node.agentName ? ` · ${node.agentName}` : node.toolName ? ` · ${node.toolName}` : ""}
      </text>
      {/* Terminal badge */}
      {isTerminal && (
        <rect
          x={layout.x + layout.w - 14}
          y={layout.y + 6}
          width={8}
          height={8}
          rx={4}
          fill="#22c55e"
        />
      )}
    </g>
  );
}

function EdgePath({
  edge,
  fromLayout,
  toLayout,
}: {
  edge: EdgeDefinition;
  fromLayout: LayoutNode;
  toLayout: LayoutNode;
}) {
  const x1 = fromLayout.x + fromLayout.w;
  const y1 = fromLayout.y + fromLayout.h / 2;
  const x2 = toLayout.x;
  const y2 = toLayout.y + toLayout.h / 2;
  const midX = (x1 + x2) / 2;

  // Bezier curve for nice routing
  const path = `M ${x1},${y1} C ${midX},${y1} ${midX},${y2} ${x2},${y2}`;

  const strokeColor =
    edge.kind === "direct" ? "#4b5563" :
    edge.kind === "conditional" ? "#f59e0b" :
    "#a78bfa";

  const strokeDash = edge.kind === "conditional" ? "6 3" : edge.kind === "llm-route" ? "3 3" : "none";

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeDasharray={strokeDash}
        markerEnd="url(#arrowhead)"
      />
      {/* Edge label on the midpoint */}
      {edge.label && (
        <g>
          <rect
            x={midX - 45}
            y={y1 < y2 ? y1 + 6 : y2 + 6}
            width={90}
            height={18}
            rx={4}
            fill="#14141a"
            stroke={strokeColor}
            strokeWidth={0.5}
            opacity={0.85}
          />
          <text
            x={midX}
            y={y1 < y2 ? y1 + 18 : y2 + 18}
            textAnchor="middle"
            fill={strokeColor}
            fontSize={9}
            fontFamily="sans-serif"
          >
            {edge.label.length > 18 ? edge.label.slice(0, 16) + ".." : edge.label}
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Main Component ──────────────────────────────────────────

type ViewMode = "list" | "graph" | "create";

export function WorkflowPage() {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>(SAMPLE_WORKFLOWS);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedWf, setSelectedWf] = useState<WorkflowDefinition | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeDefinition | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Form state for creating workflows
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formEntry, setFormEntry] = useState("");
  const [formTerminals, setFormTerminals] = useState<string[]>([]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        w.description?.toLowerCase().includes(q),
    );
  }, [workflows, searchQuery]);

  // Graph layout computation
  const layout = useMemo(() => {
    if (!selectedWf) return null;
    return computeLayout(selectedWf);
  }, [selectedWf]);

  // Get edges relevant to a selected node
  const nodeEdges = useMemo(() => {
    if (!selectedWf || !selectedNode) return { incoming: [] as EdgeDefinition[], outgoing: [] as EdgeDefinition[] };
    const incoming = selectedWf.edges.filter((e) => e.to === selectedNode.id);
    const outgoing = selectedWf.edges.filter((e) => e.from === selectedNode.id);
    return { incoming, outgoing };
  }, [selectedWf, selectedNode]);

  // ── Actions ──

  const openGraph = useCallback((wf: WorkflowDefinition) => {
    setSelectedWf(wf);
    setSelectedNode(null);
    setViewMode("graph");
  }, []);

  const backToList = useCallback(() => {
    setSelectedWf(null);
    setSelectedNode(null);
    setViewMode("list");
  }, []);

  const openCreateForm = useCallback(() => {
    setFormName("");
    setFormDesc("");
    setFormEntry("");
    setFormTerminals([]);
    setViewMode("create");
  }, []);

  const handleCreate = useCallback(() => {
    if (!formName.trim()) return;
    const id = "wf-" + formName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const newWf: WorkflowDefinition = {
      id,
      name: formName.trim(),
      description: formDesc.trim() || undefined,
      version: "0.1.0",
      entryNode: formEntry || "start",
      terminalNodes: formTerminals.length > 0 ? formTerminals : ["end"],
      initialState: {},
      nodes: [
        { id: formEntry || "start", kind: "agent" as NodeKind, label: "Start" },
        ...(formTerminals.length > 0 ? formTerminals.filter((t) => t !== formEntry).map((t) => ({ id: t, kind: "agent" as NodeKind, label: t })) : [{ id: "end", kind: "agent" as NodeKind, label: "End" }]),
      ],
      edges: [],
    };
    setWorkflows((prev) => [...prev, newWf]);
    setViewMode("list");
  }, [formName, formDesc, formEntry, formTerminals]);

  // ── Render: List View ──

  if (viewMode === "list") {
    return (
      <div className="workflow-page p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-100 mb-1">Workflows</h1>
            <p className="text-gray-500 text-sm">Design, visualize, and manage your agent workflows</p>
          </div>
          <button
            onClick={openCreateForm}
            className="px-4 py-2 bg-[#6335e7] hover:bg-[#7c4ff7] text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#6335e7]/40"
          >
            + Create Workflow
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workflows by name, ID, or description..."
            className="w-full px-4 py-2.5 bg-[#14141a] border border-[#2a2a33] rounded-xl text-gray-300 text-sm placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 transition-colors"
          />
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((wf) => {
            const status = inferStatus(wf);
            const statusColor =
              status === "active" ? { bg: "#065f4622", text: "#34d399", dot: "#34d399" } :
              status === "draft" ? { bg: "#78350f22", text: "#fbbf24", dot: "#fbbf24" } :
              { bg: "#1f293722", text: "#9ca3af", dot: "#9ca3af" };

            return (
              <div
                key={wf.id}
                onClick={() => openGraph(wf)}
                className="group bg-[#14141a] border border-[#1e1e24] rounded-xl p-5 hover:border-[#6335e7]/40 hover:bg-[#17171e] transition-all cursor-pointer"
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-gray-100 truncate group-hover:text-[#a78bfa] transition-colors">{wf.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono">{wf.id}</p>
                  </div>
                  <span
                    className="ml-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
                    style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor.dot }} />
                    {status}
                  </span>
                </div>

                {/* Description */}
                {wf.description && (
                  <p className="text-xs text-gray-600 mb-3 line-clamp-2">{wf.description}</p>
                )}

                {/* Meta row */}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>v{wf.version}</span>
                  <span>{wf.nodes.length} node{wf.nodes.length !== 1 ? "s" : ""}</span>
                  <span>{wf.edges.length} edge{wf.edges.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <p className="text-lg mb-1">No workflows found</p>
            <p className="text-sm">{searchQuery ? "Try a different search term" : "Create your first workflow to get started"}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Create Form ──

  if (viewMode === "create") {
    return (
      <div className="workflow-page p-8">
        <div className="mb-8">
          <button onClick={backToList} className="text-gray-500 hover:text-gray-300 text-sm mb-4 transition-colors">&larr; Back to Workflows</button>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Create Workflow</h1>
          <p className="text-gray-500 text-sm">Define a new workflow graph</p>
        </div>

        <div className="max-w-xl space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Workflow Name *</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Research Pipeline"
              className="w-full px-4 py-2.5 bg-[#14141a] border border-[#2a2a33] rounded-xl text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Description</label>
            <textarea
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="What does this workflow do?"
              rows={3}
              className="w-full px-4 py-2.5 bg-[#14141a] border border-[#2a2a33] rounded-xl text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 resize-none"
            />
          </div>

          {/* Entry node */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Entry Node ID</label>
            <input
              type="text"
              value={formEntry}
              onChange={(e) => setFormEntry(e.target.value)}
              placeholder="e.g. start"
              className="w-full px-4 py-2.5 bg-[#14141a] border border-[#2a2a33] rounded-xl text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 font-mono"
            />
          </div>

          {/* Terminal nodes */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Terminal Nodes{" "}
              <span className="text-gray-600 font-normal">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={formTerminals.join(", ")}
              onChange={(e) => setFormTerminals(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="e.g. end, error"
              className="w-full px-4 py-2.5 bg-[#14141a] border border-[#2a2a33] rounded-xl text-gray-300 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 font-mono"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleCreate}
              disabled={!formName.trim()}
              className="px-5 py-2.5 bg-[#6335e7] hover:bg-[#7c4ff7] disabled:bg-[#2a2a33] disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#6335e7]/40"
            >
              Create Workflow
            </button>
            <button
              onClick={backToList}
              className="px-5 py-2.5 bg-[#1e1e24] hover:bg-[#2a2a33] text-gray-300 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Graph View ──

  if (!selectedWf || !layout) {
    return (
      <div className="workflow-page p-8">
        <button onClick={backToList} className="text-gray-500 hover:text-gray-300 text-sm mb-4">&larr; Back to Workflows</button>
        <p className="text-gray-600">Loading graph...</p>
      </div>
    );
  }

  // Determine SVG viewBox
  const maxX = Math.max(...Array.from(layout.values()).map((l) => l.x + l.w)) + 20;
  const maxY = Math.max(...Array.from(layout.values()).map((l) => l.y + l.h)) + 30;

  return (
    <div className="workflow-page p-8 h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <button onClick={backToList} className="text-gray-500 hover:text-gray-300 text-sm mb-1 transition-colors">&larr; Back to Workflows</button>
          <h1 className="text-2xl font-bold text-gray-100">{selectedWf.name}</h1>
          <p className="text-xs text-gray-500 font-mono mt-0.5">
            {selectedWf.id} &middot; v{selectedWf.version}
            {selectedWf.description ? ` &middot; ${selectedWf.description}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#3b82f6]" /> Agent
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#22c55e]" /> Tool
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#f59e0b]" /> Router
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#8b5cf6]" /> Map
          </span>
        </div>
      </div>

      {/* Graph + Panel */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Graph area */}
        <div className="flex-1 bg-[#0f0f14] border border-[#1e1e24] rounded-2xl overflow-auto p-4">
          <svg
            viewBox={`0 0 ${Math.max(maxX, 400)} ${Math.max(maxY, 200)}`}
            className="w-full h-full min-h-[400px]"
          >
            <defs>
              <marker
                id="arrowhead"
                viewBox="0 0 10 7"
                refX={9}
                refY={3.5}
                markerWidth={8}
                markerHeight={6}
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
              </marker>
            </defs>

            {/* Edges */}
            {selectedWf.edges.map((edge) => {
              const fromL = layout.get(edge.from);
              const toL = layout.get(edge.to);
              if (!fromL || !toL) return null;
              return (
                <EdgePath
                  key={edge.id}
                  edge={edge}
                  fromLayout={fromL}
                  toLayout={toL}
                />
              );
            })}

            {/* Nodes */}
            {selectedWf.nodes.map((node) => {
              const nodeL = layout.get(node.id);
              if (!nodeL) return null;
              return (
                <NodeBox
                  key={node.id}
                  node={node}
                  layout={nodeL}
                  isEntry={node.id === selectedWf.entryNode}
                  isTerminal={selectedWf.terminalNodes.includes(node.id)}
                  selected={selectedNode?.id === node.id}
                  onClick={() => setSelectedNode(node)}
                />
              );
            })}
          </svg>
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-80 bg-[#14141a] border border-[#1e1e24] rounded-2xl p-4 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-100">Node Details</h3>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-gray-500 hover:text-gray-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Badge */}
            <div className="flex items-center gap-2 mb-4">
              <span
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold font-mono"
                style={{ backgroundColor: `${NODE_COLORS[selectedNode.kind]}22`, color: NODE_COLORS[selectedNode.kind], border: `1px solid ${NODE_COLORS[selectedNode.kind]}` }}
              >
                {NODE_GLYPH[selectedNode.kind] ?? "?"}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-200">{selectedNode.label ?? selectedNode.id}</p>
                <p className="text-xs text-gray-500 font-mono">{selectedNode.id} &middot; {selectedNode.kind}</p>
              </div>
            </div>

            {/* Description */}
            {selectedNode.description && (
              <div className="mb-4 p-3 bg-[#0f0f14] rounded-lg">
                <p className="text-xs text-gray-400 leading-relaxed">{selectedNode.description}</p>
              </div>
            )}

            {/* Config properties */}
            <div className="space-y-2 mb-4">
              {selectedNode.agentName && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Agent</span>
                  <span className="text-gray-300 font-mono">{selectedNode.agentName}</span>
                </div>
              )}
              {selectedNode.toolName && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Tool</span>
                  <span className="text-gray-300 font-mono">{selectedNode.toolName}</span>
                </div>
              )}
              {selectedNode.timeout !== undefined && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Timeout</span>
                  <span className="text-gray-300 font-mono">{(selectedNode.timeout / 1000).toFixed(0)}s</span>
                </div>
              )}
              {selectedNode.onError && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">On Error</span>
                  <span className="text-gray-300 font-mono">{selectedNode.onError}</span>
                </div>
              )}
              {selectedNode.subgraphId && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Subgraph</span>
                  <span className="text-gray-300 font-mono">{selectedNode.subgraphId}</span>
                </div>
              )}
            </div>

            {/* Retry policy */}
            {selectedNode.retry && (
              <div className="mb-4">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Retry Policy</h4>
                <div className="bg-[#0f0f14] rounded-lg p-3 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Max Attempts</span>
                    <span className="text-gray-300 font-mono">{selectedNode.retry.maxAttempts}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Base Delay</span>
                    <span className="text-gray-300 font-mono">{selectedNode.retry.baseDelayMs}ms</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Max Delay</span>
                    <span className="text-gray-300 font-mono">{selectedNode.retry.maxDelayMs}ms</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Backoff</span>
                    <span className="text-gray-300 font-mono">{selectedNode.retry.backoffFactor}x</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">Retryable Errors</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedNode.retry.retryableErrors.map((err) => (
                        <span key={err} className="px-1.5 py-0.5 bg-[#1e1e24] rounded text-[10px] text-gray-400 font-mono">{err}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Edges */}
            <div>
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Connected Edges</h4>

              {nodeEdges.incoming.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-gray-600 mb-1">Incoming</p>
                  {nodeEdges.incoming.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 bg-[#0f0f14] rounded-md px-2.5 py-1.5 mb-1">
                      <span className="text-xs text-gray-400 font-mono">{e.from}</span>
                      <span className="text-[10px] text-gray-600">&rarr;</span>
                      <span className="text-xs text-gray-200 font-mono">{e.to}</span>
                      <span className="ml-auto text-[10px] text-gray-600">{e.kind}</span>
                    </div>
                  ))}
                </div>
              )}

              {nodeEdges.outgoing.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 mb-1">Outgoing</p>
                  {nodeEdges.outgoing.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 bg-[#0f0f14] rounded-md px-2.5 py-1.5 mb-1">
                      <span className="text-xs text-gray-400 font-mono">{e.from}</span>
                      <span className="text-[10px] text-gray-600">&rarr;</span>
                      <span className="text-xs text-gray-200 font-mono">{e.to}</span>
                      <span className="ml-auto text-[10px] text-gray-600">{e.kind}</span>
                      {e.label && <span className="text-[10px] text-gray-600 italic">{e.label}</span>}
                    </div>
                  ))}
                </div>
              )}

              {nodeEdges.incoming.length === 0 && nodeEdges.outgoing.length === 0 && (
                <p className="text-xs text-gray-600 italic">No connected edges</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
