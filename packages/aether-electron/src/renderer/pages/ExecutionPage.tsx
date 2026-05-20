import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────

type ExecutionStatus = "running" | "completed" | "failed" | "paused" | "cancelled" | "pending";
type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface NodeExecution {
  nodeId: string;
  status: NodeStatus;
  startedAt?: number;
  completedAt?: number;
  attempt: number;
  error?: string;
  output?: unknown;
}

interface WorkflowState {
  executionId: string;
  workflowId: string;
  currentNode: string | null;
  nodeHistory: NodeExecution[];
  data: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "paused" | "cancelled";
  error?: string;
  startedAt: string;
  lastCheckpointAt?: string;
  version: number;
}

interface ExecutionSummary {
  executionId: string;
  workflowName: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  duration: string;
  tokensUsed: number;
  nodeCount: number;
  completedNodes: number;
  error?: string;
}

interface WorkflowNode {
  id: string;
  label?: string;
  kind: string;
}

interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

// ─── Mock Data ─────────────────────────────────────────────────

const MAX_DISPLAY_NODES = 15;

const MOCK_WORKFLOW_NODES: Record<string, WorkflowNode[]> = {
  "wf-code-review": [
    { id: "fetch-code", label: "Fetch Code", kind: "tool" },
    { id: "lint-check", label: "Lint Check", kind: "tool" },
    { id: "static-analysis", label: "Static Analysis", kind: "agent" },
    { id: "security-scan", label: "Security Scan", kind: "agent" },
    { id: "code-quality", label: "Code Quality", kind: "agent" },
    { id: "generate-report", label: "Generate Report", kind: "agent" },
    { id: "notify", label: "Notify Team", kind: "tool" },
    { id: "archive", label: "Archive Results", kind: "tool" },
  ],
  "wf-data-analysis": [
    { id: "load-data", label: "Load Data", kind: "tool" },
    { id: "clean", label: "Clean Data", kind: "tool" },
    { id: "transform", label: "Transform", kind: "agent" },
    { id: "analyze", label: "Analyze", kind: "agent" },
    { id: "visualize", label: "Visualize", kind: "tool" },
    { id: "export", label: "Export Results", kind: "tool" },
  ],
  "wf-security-audit": [
    { id: "scan-deps", label: "Scan Dependencies", kind: "tool" },
    { id: "vuln-check", label: "Vulnerability Check", kind: "agent" },
    { id: "compliance", label: "Compliance Check", kind: "agent" },
    { id: "report", label: "Security Report", kind: "agent" },
  ],
  "wf-deploy": [
    { id: "build", label: "Build", kind: "tool" },
    { id: "test", label: "Run Tests", kind: "tool" },
    { id: "dockerize", label: "Dockerize", kind: "tool" },
    { id: "push-registry", label: "Push to Registry", kind: "tool" },
    { id: "deploy-staging", label: "Deploy Staging", kind: "tool" },
    { id: "health-check", label: "Health Check", kind: "agent" },
    { id: "deploy-prod", label: "Deploy Production", kind: "tool" },
  ],
  "wf-research": [
    { id: "query", label: "Query Sources", kind: "tool" },
    { id: "scrape", label: "Scrape Content", kind: "tool" },
    { id: "summarize", label: "Summarize", kind: "agent" },
    { id: "synthesize", label: "Synthesize", kind: "agent" },
    { id: "format", label: "Format Report", kind: "agent" },
  ],
};

const MOCK_EDGES: Record<string, WorkflowEdge[]> = {
  "wf-code-review": [
    { id: "e1", from: "fetch-code", to: "lint-check" },
    { id: "e2", from: "lint-check", to: "static-analysis" },
    { id: "e3", from: "static-analysis", to: "security-scan" },
    { id: "e4", from: "security-scan", to: "code-quality" },
    { id: "e5", from: "code-quality", to: "generate-report" },
    { id: "e6", from: "generate-report", to: "notify" },
    { id: "e7", from: "notify", to: "archive" },
  ],
  "wf-data-analysis": [
    { id: "ed1", from: "load-data", to: "clean" },
    { id: "ed2", from: "clean", to: "transform" },
    { id: "ed3", from: "transform", to: "analyze" },
    { id: "ed4", from: "analyze", to: "visualize" },
    { id: "ed5", from: "visualize", to: "export" },
  ],
  "wf-security-audit": [
    { id: "es1", from: "scan-deps", to: "vuln-check" },
    { id: "es2", from: "vuln-check", to: "compliance" },
    { id: "es3", from: "compliance", to: "report" },
  ],
  "wf-deploy": [
    { id: "edp1", from: "build", to: "test" },
    { id: "edp2", from: "test", to: "dockerize" },
    { id: "edp3", from: "dockerize", to: "push-registry" },
    { id: "edp4", from: "push-registry", to: "deploy-staging" },
    { id: "edp5", from: "deploy-staging", to: "health-check" },
    { id: "edp6", from: "health-check", to: "deploy-prod" },
  ],
  "wf-research": [
    { id: "er1", from: "query", to: "scrape" },
    { id: "er2", from: "scrape", to: "summarize" },
    { id: "er3", from: "summarize", to: "synthesize" },
    { id: "er4", from: "synthesize", to: "format" },
  ],
};

const MOCK_WORKFLOW_NAMES: Record<string, string> = {
  "wf-code-review": "Code Review Pipeline",
  "wf-data-analysis": "Data Analysis Suite",
  "wf-security-audit": "Security Audit",
  "wf-deploy": "Deploy Pipeline",
  "wf-research": "Research Sync",
};

const WORKFLOW_ORDER = ["wf-code-review", "wf-data-analysis", "wf-security-audit", "wf-deploy", "wf-research"];

function generateNodeHistory(
  workflowId: string,
  completedCount: number
): NodeExecution[] {
  const nodes = MOCK_WORKFLOW_NODES[workflowId] || [];
  const now = Date.now();
  let accTime = 0;

  return nodes.map((node, idx) => {
    const isDone = idx < completedCount;
    const isCurrent = idx === completedCount;
    const duration = 500 + Math.floor(Math.random() * 3000);
    const startedAt = now - accTime - duration;

    let status: NodeStatus = "pending";
    if (isDone) status = "completed";
    else if (isCurrent) status = "running";

    const result: NodeExecution = {
      nodeId: node.id,
      status,
      attempt: 1,
    };
    if (isDone || isCurrent) {
      result.startedAt = startedAt;
    }
    if (isDone) {
      result.completedAt = startedAt + duration;
      result.output = { summary: `${node.label} completed successfully` };
    }
    if (isCurrent) {
      result.startedAt = startedAt;
    }
    if (idx === 2 && workflowId === "wf-security-audit" && idx < completedCount) {
      result.status = "failed";
      result.error = "Vulnerability threshold exceeded";
    }

    accTime += duration;
    return result;
  });
}

function generateMockExecutions(): ExecutionSummary[] {
  const now = new Date();
  const results: ExecutionSummary[] = [];

  WORKFLOW_ORDER.forEach((wfId, wfIdx) => {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const nodes = MOCK_WORKFLOW_NODES[wfId] || [];
      const totalNodes = nodes.length;

      let status: ExecutionStatus;
      let completed = 0;
  
      // Determine status based on a few factors
      const rand = Math.random();
      if (i === 0 && wfIdx === 0) {
        status = "running";
        completed = Math.floor(totalNodes * 0.4);
      } else if (rand < 0.45) {
        status = "completed";
        completed = totalNodes;
      } else if (rand < 0.65) {
        status = "failed";
        completed = Math.floor(totalNodes * 0.6);
      } else if (rand < 0.80) {
        status = "running";
        completed = Math.floor(totalNodes * 0.3);
      } else if (rand < 0.90) {
        status = "paused";
        completed = Math.floor(totalNodes * 0.5);
    } else {
      status = "cancelled";
      completed = Math.floor(totalNodes * 0.3);
    }

    const startedAt = new Date(now.getTime() - (wfIdx * 3600000 + i * 600000 + Math.random() * 300000));
    const durationMs = status === "running" ? Date.now() - startedAt.getTime() : 2000 + Math.random() * 120000;
    const durationStr = formatDuration(durationMs);
    const tokensUsed = Math.floor(500 + Math.random() * 15000);
    let completedAt: string | undefined;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      completedAt = new Date(startedAt.getTime() + durationMs).toISOString();
    }

    results.push({
      executionId: `exec-${wfId}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      workflowName: MOCK_WORKFLOW_NAMES[wfId] || wfId,
      workflowId: wfId,
      status,
      startedAt: startedAt.toISOString(),
      completedAt,
      duration: durationStr,
      tokensUsed,
      nodeCount: totalNodes,
      completedNodes: completed,
      error: status === "failed" ? "Node execution error: step timed out" : undefined,
    });
    }
  }
  );

  return results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs % 60}s`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Helpers ───────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "text-emerald-400";
    case "completed":
      return "text-blue-400";
    case "failed":
      return "text-red-400";
    case "paused":
      return "text-amber-400";
    case "cancelled":
      return "text-gray-500";
    default:
      return "text-gray-400";
  }
}

function getStatusBg(status: string): string {
  switch (status) {
    case "running":
      return "bg-emerald-500/10 border-emerald-500/30";
    case "completed":
      return "bg-blue-500/10 border-blue-500/30";
    case "failed":
      return "bg-red-500/10 border-red-500/30";
    case "paused":
      return "bg-amber-500/10 border-amber-500/30";
    case "cancelled":
      return "bg-gray-500/10 border-gray-500/30";
    default:
      return "bg-gray-500/10 border-gray-500/30";
  }
}

function getNodeStatusColor(status: NodeStatus): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500 border-emerald-400";
    case "running":
      return "bg-sky-500 border-sky-400";
    case "failed":
      return "bg-red-500 border-red-400";
    case "skipped":
      return "bg-gray-600 border-gray-500";
    case "pending":
      return "bg-gray-700 border-gray-600";
  }
}

function getNodeStatusIcon(status: NodeStatus): string {
  switch (status) {
    case "completed":
      return "✓";
    case "running":
      return "◉";
    case "failed":
      return "✕";
    case "skipped":
      return "―";
    case "pending":
      return "○";
  }
}

function getKindIcon(kind: string): string {
  switch (kind) {
    case "agent":
      return "🤖";
    case "tool":
      return "🔧";
    case "router":
      return "🔀";
    case "map":
      return "📡";
    case "reduce":
      return "📥";
    default:
      return "⬡";
  }
}

function getKindLabel(kind: string): string {
  switch (kind) {
    case "agent":
      return "Agent";
    case "tool":
      return "Tool";
    case "router":
      return "Router";
    case "map":
      return "Map";
    case "reduce":
      return "Reduce";
    default:
      return kind;
  }
}

// ─── Filter Types ──────────────────────────────────────────────

interface ExecutionFilters {
  status: string;
  workflowName: string;
  dateFrom: string;
  dateTo: string;
}

// ─── Live Streaming Simulation ─────────────────────────────────

type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  nodeId?: string;
};

const MOCK_LOG_LINES: string[] = [
  "Loading workflow definition...",
  "Initializing execution context",
  "Injecting state variables",
  "Resolving agent bindings",
  "Starting node execution pipeline",
  "Invoking tool: fetch-code",
  "Tool fetch-code returned 200 OK",
  "Node fetch-code completed (342ms)",
  "Transitioning to node: lint-check",
  "Invoking tool: lint-check",
  "Lint check found 3 warnings",
  "Node lint-check completed (1.2s)",
  "Transitioning to node: static-analysis",
  "LLM agent starting inference...",
  "Model response received (1242 tokens)",
  "Agent output: analysis results",
  "Node static-analysis completed (4.8s)",
  "Transitioning to node: security-scan",
  "Security scan in progress...",
  "Scanning dependency tree...",
  "Found 2 known vulnerabilities",
  "Node security-scan completed (3.1s)",
  "Transitioning to node: code-quality",
  "Quality metrics computed",
  "Node code-quality completed (2.5s)",
  "Transitioning to final node",
  "Generating final report...",
  "Execution completed successfully",
];
const MOCK_LOG_LEVELS: Array<LogEntry["level"]> = [
  "info", "info", "info", "info", "info",
  "info", "info", "info", "info", "info",
  "warn", "info", "info", "info", "info",
  "info", "info", "info", "info", "info",
  "warn", "info", "info", "info", "info",
  "info", "info", "info",
];

// ─── Sub-components ────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusBg(status)} ${getStatusColor(status)}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${getStatusColor(status).replace("text-", "bg-")}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ─── Graph Visualization ───────────────────────────────────────

function NodeGraph({
  workflowId,
  nodeHistory,
}: {
  workflowId: string;
  nodeHistory: NodeExecution[];
}) {
  const nodes = MOCK_WORKFLOW_NODES[workflowId] || [];
  const edges = MOCK_EDGES[workflowId] || [];

  if (nodes.length === 0) {
    return (
      <div className="text-gray-500 text-sm text-center py-4">
        No graph data available for this workflow
      </div>
    );
  }

  const nodeStatusMap = new Map<string, NodeStatus>();
  nodeHistory.forEach((n) => nodeStatusMap.set(n.nodeId, n.status));

  // Simple horizontal layout for the graph
  const nodeWidth = 120;
  const nodeHeight = 44;
  const hGap = 24;
  const totalWidth = nodes.length * (nodeWidth + hGap);
  const startX = 20;
  const yCenter = 60;

  return (
    <div className="overflow-x-auto">
      <svg
        width={Math.max(totalWidth + 40, 400)}
        height={140}
        className="w-full"
        viewBox={`0 0 ${Math.max(totalWidth + 40, 400)} 140`}
      >
        {/* Edges */}
        {edges.map((edge) => {
          const fromIdx = nodes.findIndex((n) => n.id === edge.from);
          const toIdx = nodes.findIndex((n) => n.id === edge.to);
          if (fromIdx === -1 || toIdx === -1) return null;
          const x1 = startX + fromIdx * (nodeWidth + hGap) + nodeWidth;
          const y1 = yCenter + nodeHeight / 2;
          const x2 = startX + toIdx * (nodeWidth + hGap);
          const y2 = yCenter + nodeHeight / 2;
          const mx = (x1 + x2) / 21;

          const fromNode = nodeHistory.find((n) => n.nodeId === edge.from);
          const toNode = nodeHistory.find((n) => n.nodeId === edge.to);
          const edgeDone =
            (fromNode?.status === "completed" || fromNode?.status === "failed") &&
            (toNode?.status !== "pending" || nodeHistory.indexOf(toNode) < nodeHistory.indexOf(fromNode));
          const edgeActive =
            fromNode?.status === "completed" && toNode?.status === "running";
          const edgeColor = edgeActive
            ? "#22d3ee"
            : edgeDone
              ? "#6366f1"
              : "#374151";

          return (
            <path
              key={edge.id}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              stroke={edgeColor}
              strokeWidth={2}
              fill="none"
              className={edgeActive ? "animate-pulse" : ""}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node, idx) => {
          const x = startX + idx * (nodeWidth + hGap);
          const status = nodeStatusMap.get(node.id) || "pending";
          const isActive = status === "running";
          const isDone = status === "completed";
          const isFailed = status === "failed";

          let fill = "#1f2937";
          let stroke = "#374151";
          let textColor = "#9ca3af";
          if (isActive) {
            fill = "#0c4a6e";
            stroke = "#22d3ee";
            textColor = "#22d3ee";
          } else if (isDone) {
            fill = "#0f3b1e";
            stroke = "#6366f1";
            textColor = "#a5b4fc";
          } else if (isFailed) {
            fill = "#3b0f0f";
            stroke = "#ef4444";
            textColor = "#fca5a5";
          }

          return (
            <g key={node.id}>
              <rect
                x={x}
                y={yCenter}
                width={nodeWidth}
                height={nodeHeight}
                rx={8}
                fill={fill}
                stroke={stroke}
                strokeWidth={isActive || isFailed ? 2 : 1}
                className={isActive ? "animate-pulse" : ""}
              />
              <text
                x={x + nodeWidth / 2}
                y={yCenter + nodeHeight / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fill={textColor}
                fontSize={11}
                fontFamily="monospace"
              >
                {getKindIcon(node.kind)} {node.label || node.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Timeline ──────────────────────────────────────────────────

function ExecutionTimeline({ nodeHistory }: { nodeHistory: NodeExecution[] }) {
  const nodes = nodeHistory;
  if (nodes.length === 0) {
    return <div className="text-gray-500 text-sm py-4 text-center">No node history available</div>;
  }

  return (
    <div className="space-y-0">
      {nodes.map((node, idx) => {
        const label = node.nodeId;
        const duration =
          node.startedAt && node.completedAt
            ? formatDuration(node.completedAt - node.startedAt)
            : node.startedAt
              ? "in progress..."
              : "—";
        const startTime = node.startedAt
          ? new Date(node.startedAt).toLocaleTimeString("en-US", {
              minute: "2-digit",
              second: "2-digit",
            })
          : "—";

        const isLast = idx === nodes.length - 1;

        return (
          <div key={node.nodeId} className="flex gap-4 relative">
            {/* Timeline line */}
            <div className="flex flex-col items-center w-6 shrink-0">
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${getNodeStatusColor(node.status)}`}
              >
                <span className="text-white">{getNodeStatusIcon(node.status)}</span>
              </div>
              {!isLast && <div className="w-0.5 flex-1 bg-gray-700" />}
            </div>

            {/* Content */}
            <div
              className={`flex-1 pb-6 ${node.status === "running" ? "animate-pulse" : ""}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-gray-200">{label}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    node.status === "running"
                      ? "bg-sky-500/20 text-sky-400"
                      : node.status === "completed"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : node.status === "failed"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-gray-600/40 text-gray-400"
                  }`}
                >
                  {node.status}
                </span>
              </div>

              <div className="flex gap-4 text-xs text-gray-500 mb-1">
                <span>⏱ {startTime}</span>
                <span>⌛ {duration}</span>
                {node.attempt > 1 && <span>Attempt #{node.attempt}</span>}
              </div>

              {node.error && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1 mb-1">
                  {node.error}
                </div>
              )}

              {!!node.output && (
                <details className="text-xs">
                  <summary className="text-gray-500 cursor-pointer hover:text-gray-400">
                    Output preview
                  </summary>
                  <pre className="mt-1 bg-gray-900/50 border border-gray-800 rounded p-2 text-gray-400 overflow-x-auto max-h-24">
                    {JSON.stringify(node.output, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Execution Detail View ─────────────────────────────────────

function ExecutionDetail({
  execution,
  onClose,
}: {
  execution: ExecutionSummary;
  onClose: () => void;
}) {
  const nodes = MOCK_WORKFLOW_NODES[execution.workflowId] || [];
  const nodeHistory = useMemo(
    () => generateNodeHistory(execution.workflowId, execution.completedNodes),
    [execution.workflowId, execution.completedNodes]
  );

  const [activeTab, setActiveTab] = useState<"timeline" | "graph" | "stream">(
    execution.status === "running" ? "stream" : "timeline"
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors text-lg"
          >
            ←
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-100">{execution.workflowName}</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-sm text-gray-500">{execution.executionId}</span>
              <StatusBadge status={execution.status} />
            </div>
          </div>
        </div>
        {execution.error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 max-w-xs">
            Error: {execution.error}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Started", value: formatDateTime(execution.startedAt) },
          { label: "Duration", value: execution.duration },
          { label: "Tokens Used", value: execution.tokensUsed.toLocaleString() },
          {
            label: "Nodes",
            value: `${execution.completedNodes} / ${execution.nodeCount}`,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#14141a] border border-[#1e1e24] rounded-xl px-4 py-3"
          >
            <div className="text-xs text-gray-500 mb-0.5">{stat.label}</div>
            <div className="text-sm font-medium text-gray-200">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#1e1e24]">
        {[
          { id: "timeline" as const, label: "Timeline" },
          { id: "graph" as const, label: "Graph" },
          { id: "stream" as const, label: "Live Stream" },
        ].map((tab) => {
          const tabActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors " + (tabActive ? "text-violet-400 border-violet-500" : "text-gray-500 border-transparent hover:text-gray-300")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl p-6">
        {activeTab === "timeline" && <ExecutionTimeline nodeHistory={nodeHistory} />}
        {activeTab === "graph" && (
          <NodeGraph workflowId={execution.workflowId} nodeHistory={nodeHistory} />
        )}
        {activeTab === "stream" && <LiveStream executionId={execution.executionId} />}
      </div>

      {/* Full state JSON */}
      <details className="bg-[#14141a] border border-[#1e1e24] rounded-xl">
        <summary className="px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-gray-300 font-medium">
          Full State
        </summary>
        <div className="border-t border-[#1e1e24]">
          <pre className="p-4 text-xs text-gray-500 overflow-x-auto max-h-96">
            {JSON.stringify(
              {
                executionId: execution.executionId,
                workflowId: execution.workflowId,
                status: execution.status,
                startedAt: execution.startedAt,
                completedAt: execution.completedAt,
                error: execution.error,
                nodeCount: execution.nodeCount,
                completedNodes: execution.completedNodes,
                nodes: nodes,
                nodeHistory: nodeHistory,
              },
              null,
              2
            )}
          </pre>
        </div>
      </details>
    </div>
  );
}

// ─── Live Stream ───────────────────────────────────────────────

function LiveStream({ executionId }: { executionId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logIndex, setLogIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setLogIndex((prev) => {
        if (prev >= MOCK_LOG_LINES.length) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return prev;
        }
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          level: MOCK_LOG_LEVELS[prev] || "info",
          message: MOCK_LOG_LINES[prev],
          nodeId: prev % 3 === 0 ? `node-${Math.floor(prev / 3)}` : undefined,
        };
        setLogs((prevLogs) => [...prevLogs, entry]);
        return prev + 1;
      });
    }, 400 + Math.random() * 600);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPaused]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "error":
        return "text-red-400";
      case "warn":
        return "text-amber-400";
      case "info":
        return "text-gray-300";
      case "debug":
        return "text-gray-500";
    }
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPaused((p) => !p)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1e1e24] border border-[#2a2a33] text-gray-300 hover:bg-[#2a2a33] transition-colors"
          >
            {isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button
            onClick={() => {
              setLogs([]);
              setLogIndex(0);
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1e1e24] border border-[#2a2a33] text-gray-300 hover:bg-[#2a2a33] transition-colors"
          >
            ⟳ Clear
          </button>
          <button
            onClick={() => {
              // Jump to the end
              const remaining = MOCK_LOG_LINES.length - logIndex;
              for (let i = 0; i < remaining; i++) {
                const entry: LogEntry = {
                  timestamp: new Date().toISOString(),
                  level: MOCK_LOG_LEVELS[logIndex + i] || "info",
                  message: MOCK_LOG_LINES[logIndex + i],
                };
                setLogs((prev) => [...prev, entry]);
              }
              setLogIndex(MOCK_LOG_LINES.length);
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1e1e24] border border-[#2a2a33] text-gray-300 hover:bg-[#2a2a33] transition-colors"
          >
            ⏩ Complete
          </button>
        </div>
        <span className="text-xs text-gray-500">
          {logIndex >= MOCK_LOG_LINES.length ? "Execution complete" : `${logIndex} events`}
        </span>
      </div>

      {/* Log terminal */}
      <div
        ref={scrollRef}
        className="bg-black/60 border border-[#1e1e24] rounded-lg p-3 h-64 overflow-y-auto font-mono text-xs space-y-0.5"
      >
        {logs.length === 0 ? (
          <div className="text-gray-600 text-center py-8">
            Waiting for stream data...
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="text-gray-600 shrink-0 w-16">
                {new Date(log.timestamp).toLocaleTimeString("en-US", {
                  minute: "2-digit",
                  second: "2-digit",
                })}
                .{String(new Date(log.timestamp).getMilliseconds()).padStart(3, "0")}
              </span>
              <span className="shrink-0 w-10 text-center">
                {log.level === "info" && <span className="text-blue-500">INFO</span>}
                {log.level === "warn" && <span className="text-amber-500">WARN</span>}
                {log.level === "error" && <span className="text-red-500">ERROR</span>}
                {log.level === "debug" && <span className="text-gray-600">DEBUG</span>}
              </span>
              {log.nodeId && (
                <span className="text-gray-600 shrink-0">[{log.nodeId}]</span>
              )}
              <span className={getLevelColor(log.level)}>{log.message}</span>
            </div>
          ))
        )}
        {logIndex < MOCK_LOG_LINES.length && (
          <div className="flex items-center gap-2 text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Streaming...
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Execution Table Row ───────────────────────────────────────

function ExecutionRow({
  execution,
  onViewDetails,
  onPauseResume,
  onCancel,
}: {
  execution: ExecutionSummary;
  onViewDetails: () => void;
  onPauseResume: () => void;
  onCancel: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  const canPause = execution.status === "running";
  const canResume = execution.status === "paused";
  const canCancel = execution.status === "running" || execution.status === "paused";

  return (
    <tr
      className="border-b border-[#1e1e24] hover:bg-[#1a1a22] transition-colors"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <td className="py-3 px-4">
        <span className="text-sm font-mono text-gray-300">{execution.executionId}</span>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm text-gray-200">{execution.workflowName}</span>
      </td>
      <td className="py-3 px-4">
        <StatusBadge status={execution.status} />
      </td>
      <td className="py-3 px-4">
        <div className="text-sm text-gray-400">{formatDateTime(execution.startedAt)}</div>
        <div className="text-xs text-gray-600">{relativeTime(execution.startedAt)}</div>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm text-gray-300">{execution.duration}</span>
      </td>
      <td className="py-3 px-4">
        <span className="text-sm text-gray-400">{execution.tokensUsed.toLocaleString()}</span>
      </td>
      <td className="py-3 px-4">
        <ProgressBar completed={execution.completedNodes} total={execution.nodeCount} />
      </td>
      <td className="py-3 px-4">
        <div
          className={`flex items-center gap-1.5 ${showActions ? "opacity-100" : "opacity-0"} transition-opacity`}
        >
          {canPause && (
            <button
              onClick={(e) => { e.stopPropagation(); onPauseResume(); }}
              className="px-2 py-1 text-xs font-medium rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors"
              title="Pause execution"
            >
              ⏸ Pause
            </button>
          )}
          {canResume && (
            <button
              onClick={(e) => { e.stopPropagation(); onPauseResume(); }}
              className="px-2 py-1 text-xs font-medium rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              title="Resume execution"
            >
              ▶ Resume
            </button>
          )}
          {canCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="px-2 py-1 text-xs font-medium rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
              title="Cancel execution"
            >
              ✕ Cancel
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
            className="px-2 py-1 text-xs font-medium rounded bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-colors"
            title="View details"
          >
            View
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main ExecutionPage ────────────────────────────────────────

export function ExecutionPage() {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [selectedExecution, setSelectedExecution] = useState<ExecutionSummary | null>(null);
  const [filters, setFilters] = useState<ExecutionFilters>({
    status: "",
    workflowName: "",
    dateFrom: "",
    dateTo: "",
  });
  const [showFilters, setShowFilters] = useState(false);
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  useEffect(() => {
    // Load mock data on mount
    setExecutions(generateMockExecutions());
  }, []);

  // Toast notification
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Filtered executions
  const filteredExecutions = useMemo(() => {
    return executions.filter((ex) => {
      if (filters.status && ex.status !== filters.status) return false;
      if (
        filters.workflowName &&
        !ex.workflowName.toLowerCase().includes(filters.workflowName.toLowerCase())
      )
        return false;
      if (filters.dateFrom && new Date(ex.startedAt) < new Date(filters.dateFrom))
        return false;
      if (filters.dateTo && new Date(ex.startedAt) > new Date(filters.dateTo))
        return false;
      return true;
    });
  }, [executions, filters]);

  // Stats
  const stats = useMemo(() => {
    const total = executions.length;
    const running = executions.filter((e) => e.status === "running").length;
    const completed = executions.filter((e) => e.status === "completed").length;
    const failed = executions.filter((e) => e.status === "failed").length;
    const paused = executions.filter((e) => e.status === "paused").length;
    const totalTokens = executions.reduce((sum, e) => sum + e.tokensUsed, 0);
    return { total, running, completed, failed, paused, totalTokens };
  }, [executions]);

  // Actions
  const handlePauseResume = useCallback(
    (executionId: string) => {
      setExecutions((prev) =>
        prev.map((ex) => {
          if (ex.executionId !== executionId) return ex;
          const newStatus: ExecutionStatus =
            ex.status === "running" ? "paused" : "running";
          return { ...ex, status: newStatus };
        })
      );
      const ex = executions.find((e) => e.executionId === executionId);
      const action = ex?.status === "running" ? "Paused" : "Resumed";
      showToast(`${action} execution ${executionId.slice(0, 12)}...`, "success");
    },
    [executions, showToast]
  );

  const handleCancel = useCallback(
    (executionId: string) => {
      setExecutions((prev) =>
        prev.map((ex) =>
          ex.executionId === executionId ? { ...ex, status: "cancelled" as const } : ex
        )
      );
      showToast(`Cancelled execution ${executionId.slice(0, 12)}...`, "info");
    },
    [showToast]
  );

  // If viewing details
  if (selectedExecution) {
    return (
      <div className="p-8">
        <ExecutionDetail
          execution={selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Notification toast */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg transition-all duration-300 ${
            notification.type === "success"
              ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-300"
              : notification.type === "error"
                ? "bg-red-500/20 border border-red-500/30 text-red-300"
                : "bg-blue-500/20 border border-blue-500/30 text-blue-300"
          }`}
        >
          {notification.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-1">Execution Dashboard</h1>
          <p className="text-gray-500 text-sm">
            Monitor and manage active and completed agent executions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setExecutions(generateMockExecutions());
              showToast("Refreshed execution list", "info");
            }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1e1e24] border border-[#2a2a33] text-gray-300 hover:bg-[#2a2a33] transition-colors"
          >
            ⟳ Refresh
          </button>
          <button
            onClick={() => setShowFilters((f) => !f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showFilters
                ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                : "bg-[#1e1e24] border-[#2a2a33] text-gray-300 hover:bg-[#2a2a33]"
            }`}
          >
            ☰ Filters
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-6 gap-4 mb-6">
        {[
          { label: "Total", value: stats.total, color: "text-gray-200" },
          { label: "Running", value: stats.running, color: "text-emerald-400" },
          { label: "Completed", value: stats.completed, color: "text-blue-400" },
          { label: "Failed", value: stats.failed, color: "text-red-400" },
          { label: "Paused", value: stats.paused, color: "text-amber-400" },
          {
            label: "Tokens",
            value: stats.totalTokens.toLocaleString(),
            color: "text-violet-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#14141a] border border-[#1e1e24] rounded-xl px-4 py-3"
          >
            <div className="text-xs text-gray-500 mb-0.5">{stat.label}</div>
            <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl p-4 mb-6">
          <div className="grid grid-cols-4 gap-4">
            {/* Status filter */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                className="w-full bg-[#0f0f13] border border-[#2a2a33] rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500/50"
              >
                <option value="">All Statuses</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            {/* Workflow name filter */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Workflow Name</label>
              <input
                type="text"
                value={filters.workflowName}
                onChange={(e) => setFilters((f) => ({ ...f, workflowName: e.target.value }))}
                placeholder="Search workflows..."
                className="w-full bg-[#0f0f13] border border-[#2a2a33] rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>

            {/* Date from */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                className="w-full bg-[#0f0f13] border border-[#2a2a33] rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500/50"
              />
            </div>

            {/* Date to */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
                className="w-full bg-[#0f0f13] border border-[#2a2a33] rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>

          <div className="flex justify-end mt-3">
            <button
              onClick={() =>
                setFilters({ status: "", workflowName: "", dateFrom: "", dateTo: "" })
              }
              className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {/* Execution table */}
      <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e1e24] bg-[#0f0f13]/50">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Execution ID
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Workflow
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Started
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tokens
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Progress
                </th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredExecutions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-3xl">📋</span>
                      <p className="text-gray-500 text-sm">No executions found</p>
                      <p className="text-gray-600 text-xs">
                        Try adjusting your filters or triggering a new workflow
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredExecutions.map((execution) => (
                  <ExecutionRow
                    key={execution.executionId}
                    execution={execution}
                    onViewDetails={() => setSelectedExecution(execution)}
                    onPauseResume={() => handlePauseResume(execution.executionId)}
                    onCancel={() => handleCancel(execution.executionId)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with count */}
        <div className="border-t border-[#1e1e24] px-4 py-2.5 flex items-center justify-between bg-[#0f0f13]/30">
          <span className="text-xs text-gray-600">
            Showing {filteredExecutions.length} of {executions.length} executions
          </span>
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" title="Running" />
            <span className="w-2 h-2 rounded-full bg-blue-500" title="Completed" />
            <span className="w-2 h-2 rounded-full bg-red-500" title="Failed" />
            <span className="w-2 h-2 rounded-full bg-amber-500" title="Paused" />
          </div>
        </div>
      </div>
    </div>
  );
}
