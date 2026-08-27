import React, { useState, useCallback } from "react";

// ─── Local AgentConfig type (mirrors @aether/sdk/types) ───────────────

interface AgentTool {
  id?: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
  timeout: number;
  sandboxed: boolean;
}

interface AgentConfig {
  name: string;
  model: string;
  instructions: string;
  tools: AgentTool[];
  handoffs: string[];
  outputType?: string;
  guardrails: string[];
  maxTurns: number;
  context?: Record<string, unknown>;
}

// ─── Mock Data ────────────────────────────────────────────────────────

const BUILTIN_TOOLS = [
  { id: "web_search", name: "Web Search", description: "Search the web for information" },
  { id: "web_scrape", name: "Web Scrape", description: "Scrape and extract content from web pages" },
  { id: "file_read", name: "File Reader", description: "Read files from the filesystem" },
  { id: "file_write", name: "File Writer", description: "Write files to the filesystem" },
  { id: "code_exec", name: "Code Execution", description: "Execute Python/JavaScript code in a sandbox" },
  { id: "memory_read", name: "Memory Read", description: "Retrieve stored memories and context" },
  { id: "memory_write", name: "Memory Write", description: "Store information in long-term memory" },
  { id: "calculator", name: "Calculator", description: "Perform mathematical calculations" },
];

interface RunHistoryEntry {
  id: string;
  timestamp: string;
  input: string;
  output: string;
  turns: number;
  tokens: number;
  status: "success" | "error" | "timeout";
}

const RUN_HISTORY: Record<string, RunHistoryEntry[]> = {
  "agent-1": [
    { id: "run-1", timestamp: "2026-05-10T14:23:00", input: "Research quantum computing trends", output: "Here's a comprehensive overview...", turns: 5, tokens: 2340, status: "success" },
    { id: "run-2", timestamp: "2026-05-10T12:10:00", input: "Summarize the latest AI paper", output: "The paper introduces a novel...", turns: 3, tokens: 1890, status: "success" },
    { id: "run-3", timestamp: "2026-05-09T18:45:00", input: "Write a blog post about agents", output: "## The Rise of Autonomous Agents...", turns: 8, tokens: 4200, status: "success" },
    { id: "run-4", timestamp: "2026-05-09T09:30:00", input: "Analyze server logs", output: "Error: connection refused on port 443", turns: 2, tokens: 890, status: "error" },
    { id: "run-5", timestamp: "2026-05-08T22:15:00", input: "Generate code for Fibonacci", output: "def fib(n):\n    if n <= 1: return n...", turns: 4, tokens: 1560, status: "success" },
  ],
  "agent-2": [
    { id: "run-6", timestamp: "2026-05-10T15:00:00", input: "Draft an email to the team", output: "Subject: Weekly Update\n\nHi team...", turns: 2, tokens: 980, status: "success" },
    { id: "run-7", timestamp: "2026-05-10T10:30:00", input: "Translate document to French", output: "Le document a ete traduit...", turns: 3, tokens: 2100, status: "success" },
    { id: "run-8", timestamp: "2026-05-09T16:20:00", input: "Proofread this article", output: "I found 12 issues including...", turns: 4, tokens: 3100, status: "success" },
    { id: "run-9", timestamp: "2026-05-09T08:00:00", input: "Write meeting notes", output: "Meeting Notes - May 9...", turns: 1, tokens: 540, status: "success" },
    { id: "run-10", timestamp: "2026-05-08T19:45:00", input: "Create a presentation outline", output: "## Slide 1: Introduction...", turns: 5, tokens: 2800, status: "success" },
  ],
  "agent-3": [
    { id: "run-11", timestamp: "2026-05-10T13:00:00", input: "Find bugs in the auth module", output: "I identified 3 critical issues...", turns: 7, tokens: 4500, status: "success" },
    { id: "run-12", timestamp: "2026-05-09T20:10:00", input: "Optimize the SQL query", output: "Using an index on user_id...", turns: 4, tokens: 2100, status: "success" },
    { id: "run-13", timestamp: "2026-05-09T11:30:00", input: "Refactor the API endpoint", output: "##### /api/v2/users\n\nRefactored...", turns: 6, tokens: 3800, status: "success" },
    { id: "run-14", timestamp: "2026-05-08T14:00:00", input: "Review PR #342", output: "## Code Review Summary\n\nLooks good...", turns: 3, tokens: 1700, status: "success" },
    { id: "run-15", timestamp: "2026-05-08T07:30:00", input: "Deploy to staging", output: "Deployment failed: docker build timeout", turns: 5, tokens: 2600, status: "error" },
  ],
};

interface MockAgent {
  id: string;
  config: AgentConfig;
  status: "idle" | "running" | "error" | "paused";
  lastRun: string | null;
  createdAt: string;
}

const MOCK_AGENTS: MockAgent[] = [
  {
    id: "agent-1",
    config: {
      name: "Research Bot",
      model: "gpt-4o",
      instructions: "You are a research assistant. Search the web, summarize findings, and generate comprehensive reports. Always cite your sources.",
      tools: [
        { id: "t1", name: "Web Search", description: "Search the web for information", parameters: {}, enabled: true, timeout: 30000, sandboxed: false },
        { id: "t2", name: "Web Scrape", description: "Scrape and extract content from web pages", parameters: {}, enabled: true, timeout: 45000, sandboxed: false },
        { id: "t3", name: "Memory Read", description: "Retrieve stored memories", parameters: {}, enabled: true, timeout: 10000, sandboxed: false },
        { id: "t4", name: "Memory Write", description: "Store information in long-term memory", parameters: {}, enabled: false, timeout: 10000, sandboxed: false },
      ],
      handoffs: ["Writing Bot"],
      outputType: "markdown",
      guardrails: ["content-filter", "citation-required"],
      maxTurns: 25,
      context: { domain: "technology", citation_style: "apa" },
    },
    status: "idle",
    lastRun: "2026-05-10T14:23:00",
    createdAt: "2026-04-01T10:00:00",
  },
  {
    id: "agent-2",
    config: {
      name: "Writing Bot",
      model: "claude-3-5-sonnet",
      instructions: "You are a professional writing assistant. Help with drafting, editing, proofreading, and translating content. Maintain a formal yet approachable tone.",
      tools: [
        { id: "t5", name: "File Reader", description: "Read files from the filesystem", parameters: {}, enabled: true, timeout: 15000, sandboxed: true },
        { id: "t6", name: "File Writer", description: "Write files to the filesystem", parameters: {}, enabled: true, timeout: 15000, sandboxed: true },
      ],
      handoffs: ["Research Bot"],
      outputType: undefined,
      guardrails: ["content-filter"],
      maxTurns: 30,
      context: { default_language: "en" },
    },
    status: "running",
    lastRun: "2026-05-10T15:00:00",
    createdAt: "2026-04-05T14:30:00",
  },
  {
    id: "agent-3",
    config: {
      name: "Code Reviewer",
      model: "gpt-4o-mini",
      instructions: "You are a senior software engineer reviewing code. Analyze pull requests, find bugs, suggest optimizations, and ensure best practices. Be thorough but constructive.",
      tools: [
        { id: "t7", name: "Code Execution", description: "Execute code in a sandbox", parameters: {}, enabled: true, timeout: 60000, sandboxed: true },
        { id: "t8", name: "File Reader", description: "Read files from the filesystem", parameters: {}, enabled: true, timeout: 15000, sandboxed: true },
        { id: "t9", name: "Calculator", description: "Perform mathematical calculations", parameters: {}, enabled: true, timeout: 5000, sandboxed: false },
      ],
      handoffs: ["Research Bot", "Writing Bot"],
      outputType: "markdown",
      guardrails: ["code-safety", "content-filter"],
      maxTurns: 20,
      context: { languages: "typescript,python,rust" },
    },
    status: "idle",
    lastRun: "2026-05-10T13:00:00",
    createdAt: "2026-04-10T09:00:00",
  },
  {
    id: "agent-4",
    config: {
      name: "Data Analyst",
      model: "claude-opus-4",
      instructions: "You are a data analyst. Process datasets, generate visualizations, and provide insights. Always validate data quality before analysis.",
      tools: [
        { id: "t10", name: "Code Execution", description: "Execute Python/R code", parameters: {}, enabled: true, timeout: 120000, sandboxed: true },
        { id: "t11", name: "Calculator", description: "Perform calculations", parameters: {}, enabled: true, timeout: 5000, sandboxed: false },
      ],
      handoffs: [],
      outputType: undefined,
      guardrails: [],
      maxTurns: 15,
      context: {},
    },
    status: "paused",
    lastRun: null,
    createdAt: "2026-05-01T16:00:00",
  },
  {
    id: "agent-5",
    config: {
      name: "Customer Support",
      model: "gpt-4o",
      instructions: "You are a customer support agent. Be helpful, empathetic, and efficient. Escalate complex issues to human agents when necessary.",
      tools: [
        { id: "t12", name: "Memory Read", description: "Retrieve past conversations", parameters: {}, enabled: true, timeout: 10000, sandboxed: false },
        { id: "t13", name: "Memory Write", description: "Save conversation summaries", parameters: {}, enabled: true, timeout: 10000, sandboxed: false },
        { id: "t14", name: "Web Search", description: "Search knowledge base", parameters: {}, enabled: true, timeout: 20000, sandboxed: false },
      ],
      handoffs: ["Research Bot"],
      outputType: undefined,
      guardrails: ["content-filter", "pii-filter"],
      maxTurns: 40,
      context: { knowledge_base_id: "kb-main", escalation_threshold: 0.8 },
    },
    status: "idle",
    lastRun: "2026-05-09T21:00:00",
    createdAt: "2026-04-20T12:00:00",
  },
];

// ─── Helper: create a blank AgentConfig for new agent form ────────────

function blankAgentConfig(): AgentConfig {
  return {
    name: "",
    model: "",
    instructions: "",
    tools: [],
    handoffs: [],
    outputType: undefined,
    guardrails: [],
    maxTurns: 25,
  };
}

// ─── Helper: status badge styling ─────────────────────────────────────

function statusBadge(status: MockAgent["status"]) {
  const map: Record<MockAgent["status"], { bg: string; dot: string; label: string }> = {
    idle:    { bg: "bg-[#1a2e1a]", dot: "bg-emerald-400", label: "Idle" },
    running: { bg: "bg-[#1a2a3e]", dot: "bg-blue-400",   label: "Running" },
    error:   { bg: "bg-[#3e1a1a]", dot: "bg-red-400",    label: "Error" },
    paused:  { bg: "bg-[#2e2a1a]", dot: "bg-amber-400",  label: "Paused" },
  };
  return map[status];
}

// ─── Helper: format date to relative-ish ──────────────────────────────

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Sub-component: Tool Checkbox ─────────────────────────────────────

function ToolCheckbox({
  tool,
  checked,
  onChange,
}: {
  tool: { id: string; name: string; description: string };
  checked: boolean;
  onChange: (id: string, checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#ffffff08] cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(tool.id, e.target.checked)}
        className="mt-0.5 accent-[#a78bfa] w-4 h-4 rounded border-[#3a3a4e] bg-[#1c1c24]"
      />
      <div>
        <span className="text-sm text-gray-200 font-medium">{tool.name}</span>
        <p className="text-xs text-gray-500 mt-0.5">{tool.description}</p>
      </div>
    </label>
  );
}

// ─── View: Agent List ─────────────────────────────────────────────────

function AgentListView({
  agents,
  onCreate,
  onSelect,
}: {
  agents: MockAgent[];
  onCreate: () => void;
  onSelect: (agent: MockAgent) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = agents.filter((a) =>
    a.config.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="agent-page p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">Agent Management</h1>
          <p className="text-gray-500 text-sm">Create, configure, and deploy AI agents with custom capabilities</p>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#6335e7] hover:bg-[#7c4ff7] text-white text-sm font-medium rounded-xl transition-colors shadow-lg shadow-[#6335e7]/20"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Agent
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents..."
          className="w-full pl-10 pr-4 py-2.5 bg-[#14141a] border border-[#2a2a33] rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 transition-colors"
        />
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 mb-6 text-xs text-gray-500">
        <span><strong className="text-gray-300">{agents.length}</strong> total</span>
        <span><strong className="text-emerald-400">{agents.filter((a) => a.status === "idle").length}</strong> idle</span>
        <span><strong className="text-blue-400">{agents.filter((a) => a.status === "running").length}</strong> running</span>
        <span><strong className="text-amber-400">{agents.filter((a) => a.status === "paused").length}</strong> paused</span>
        <span><strong className="text-red-400">{agents.filter((a) => a.status === "error").length}</strong> error</span>
      </div>

      {/* Agent Cards */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center h-48 bg-[#14141a] border border-dashed border-[#2a2a33] rounded-2xl">
          <p className="text-gray-600 text-sm">No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((agent) => {
            const badge = statusBadge(agent.status);
            return (
              <button
                key={agent.id}
                onClick={() => onSelect(agent)}
                className="text-left bg-[#14141a] border border-[#1e1e24] rounded-2xl p-5 hover:border-[#6335e7]/40 hover:bg-[#181820] transition-all group"
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#6335e7]/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">🤖</span>
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-gray-100 truncate">{agent.config.name}</h3>
                      <p className="text-xs text-gray-500 truncate">{agent.config.model}</p>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium ${badge.bg} ${badge.dot.replace("bg-", "text-")} whitespace-nowrap ml-2`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>
                </div>

                {/* Quick info */}
                <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {agent.config.tools.length} tools
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    {agent.config.handoffs.length > 0
                      ? agent.config.handoffs.join(", ")
                      : "No handoffs"}
                  </span>
                </div>

                {/* Last run */}
                <div className="text-[11px] text-gray-600 group-hover:text-gray-500 transition-colors">
                  Last run: {formatTimestamp(agent.lastRun)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── View: Agent Create/Edit Form ─────────────────────────────────────

function AgentFormView({
  initial,
  allAgentNames,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: AgentConfig;
  allAgentNames: string[];
  onSave: (config: AgentConfig) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const isEditing = !!initial.name;
  const [config, setConfig] = useState<AgentConfig>({ ...initial, tools: initial.tools.map((t) => ({ ...t })) });

  const update = useCallback(
    (patch: Partial<AgentConfig>) => setConfig((c) => ({ ...c, ...patch })),
    [],
  );

  const handoffCandidates = allAgentNames.filter((n) => n !== config.name);

  const handleToolToggle = useCallback(
    (toolId: string, checked: boolean) => {
      const toolDef = BUILTIN_TOOLS.find((t) => t.id === toolId);
      if (!toolDef) return;
      if (checked) {
        // Add tool
        setConfig((c) => ({
          ...c,
          tools: [
            ...c.tools,
            {
              id: toolId,
              name: toolDef.name,
              description: toolDef.description,
              parameters: {},
              enabled: true,
              timeout: 30000,
              sandboxed: true,
            },
          ],
        }));
      } else {
        // Remove tool
        setConfig((c) => ({
          ...c,
          tools: c.tools.filter((t) => t.name !== toolDef.name),
        }));
      }
    },
    [],
  );

  const handleHandoffToggle = useCallback(
    (name: string) => {
      setConfig((c) => ({
        ...c,
        handoffs: c.handoffs.includes(name)
          ? c.handoffs.filter((h) => h !== name)
          : [...c.handoffs, name],
      }));
    },
    [],
  );

  const valid = config.name.trim().length > 0;

  return (
    <div className="agent-page p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-100">{isEditing ? "Edit Agent" : "Create Agent"}</h1>
            <p className="text-gray-500 text-sm mt-1">
              {isEditing ? `Editing "${initial.name}"` : "Configure a new AI agent"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isEditing && onDelete && (
            <button
              onClick={onDelete}
              className="px-4 py-2 bg-[#3e1a1a] hover:bg-[#5a2222] text-red-400 text-sm font-medium rounded-xl transition-colors"
            >
              Delete Agent
            </button>
          )}
          <button
            onClick={() => onSave(config)}
            disabled={!valid}
            className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all ${
              valid
                ? "bg-[#6335e7] hover:bg-[#7c4ff7] text-white shadow-lg shadow-[#6335e7]/20"
                : "bg-[#2a2a33] text-gray-600 cursor-not-allowed"
            }`}
          >
            {isEditing ? "Save Changes" : "Create Agent"}
          </button>
        </div>
      </div>

      {/* Form content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left column: main config */}
        <div className="xl:col-span-2 space-y-6">
          {/* Identity */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Identity</h2>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Agent Name *</label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="e.g. Research Assistant"
                className="w-full px-4 py-2.5 bg-[#1c1c24] border border-[#2a2a33] rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Model Identifier</label>
              <input
                type="text"
                value={config.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                className="w-full px-4 py-2.5 bg-[#1c1c24] border border-[#2a2a33] rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">System Instructions</label>
              <textarea
                value={config.instructions}
                onChange={(e) => update({ instructions: e.target.value })}
                placeholder="Describe the agent's role, behavior, and constraints..."
                rows={6}
                className="w-full px-4 py-2.5 bg-[#1c1c24] border border-[#2a2a33] rounded-xl text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#6335e7]/50 transition-colors resize-y min-h-[120px] font-mono"
              />
            </div>
          </section>

          {/* Tools */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Tools</h2>
              <span className="text-xs text-gray-500">{config.tools.length} selected</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {BUILTIN_TOOLS.map((tool) => (
                <ToolCheckbox
                  key={tool.id}
                  tool={tool}
                  checked={config.tools.some((t) => t.name === tool.name && t.enabled)}
                  onChange={handleToolToggle}
                />
              ))}
            </div>
          </section>

          {/* Handoff Targets */}
          {handoffCandidates.length > 0 && (
            <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Handoff Targets</h2>
                <span className="text-xs text-gray-500">{config.handoffs.length} selected</span>
              </div>
              <p className="text-xs text-gray-500 -mt-2">Agents this agent can delegate tasks to</p>
              <div className="flex flex-wrap gap-2">
                {handoffCandidates.map((name) => {
                  const selected = config.handoffs.includes(name);
                  return (
                    <button
                      key={name}
                      onClick={() => handleHandoffToggle(name)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        selected
                          ? "bg-[#6335e7]/20 border-[#6335e7]/40 text-[#a78bfa]"
                          : "bg-[#1c1c24] border-[#2a2a33] text-gray-400 hover:text-gray-200 hover:border-[#3a3a4e]"
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Right column: parameters */}
        <div className="space-y-6">
          {/* Parameters */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Parameters</h2>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">Max Turns</label>
              <input
                type="number"
                min={1}
                max={200}
                value={config.maxTurns}
                onChange={(e) => update({ maxTurns: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-full px-4 py-2.5 bg-[#1c1c24] border border-[#2a2a33] rounded-xl text-sm text-gray-200 focus:outline-none focus:border-[#6335e7]/50 transition-colors"
              />
              <p className="text-[10px] text-gray-600 mt-1">Maximum execution turns before forced handoff</p>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5 font-medium">
                Temperature: <span className="text-gray-300">{(0.7).toFixed(1)}</span>
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                defaultValue={0.7}
                className="w-full accent-[#a78bfa]"
              />
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>Precise (0)</span>
                <span>Creative (2)</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs text-gray-500 font-medium">Structured Output</label>
                <p className="text-[10px] text-gray-600 mt-0.5">Enforce JSON schema output</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!config.outputType}
                  onChange={(e) => update({ outputType: e.target.checked ? "json" : undefined })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#2a2a33] rounded-full peer peer-checked:bg-[#6335e7] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              </label>
            </div>
          </section>

          {/* Guardrails placeholder */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Guardrails</h2>
            {config.guardrails.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {config.guardrails.map((g) => (
                  <span key={g} className="px-2.5 py-1 bg-[#1c1c24] border border-[#2a2a33] rounded-lg text-[11px] text-gray-400">
                    {g}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600">No guardrails configured</p>
            )}
            <p className="text-[10px] text-gray-600">Guardrail configuration will be available in a future update</p>
          </section>

          {/* Context placeholder */}
          {Object.keys(config.context ?? {}).length > 0 && (
            <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-3">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Context</h2>
              <div className="space-y-1.5">
                {Object.entries(config.context ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{key}</span>
                    <span className="text-gray-500 font-mono">{String(value)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── View: Agent Detail ───────────────────────────────────────────────

function AgentDetailView({
  agent,
  onEdit,
  onBack,
  onToggleTool,
}: {
  agent: MockAgent;
  onEdit: () => void;
  onBack: () => void;
  onToggleTool: (agentId: string, toolName: string, enabled: boolean) => void;
}) {
  const badge = statusBadge(agent.status);
  const history = RUN_HISTORY[agent.id] ?? [];

  return (
    <div className="agent-page p-8">
      {/* Back + Header */}
      <div className="mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Agents
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#6335e7]/15 flex items-center justify-center">
              <span className="text-2xl">🤖</span>
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-100">{agent.config.name}</h1>
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${badge.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                  {badge.label}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{agent.config.model}</p>
            </div>
          </div>
          <button
            onClick={onEdit}
            className="flex items-center gap-2 px-4 py-2 bg-[#6335e7]/20 hover:bg-[#6335e7]/40 text-[#a78bfa] text-sm font-medium rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
        </div>
      </div>

      {/* Two-column detail layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: config summary + tools */}
        <div className="xl:col-span-2 space-y-6">
          {/* Config Summary */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Configuration</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500 text-xs block mb-1">Name</span>
                <span className="text-gray-200">{agent.config.name}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block mb-1">Model</span>
                <span className="text-gray-200">{agent.config.model}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block mb-1">Max Turns</span>
                <span className="text-gray-200">{agent.config.maxTurns}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block mb-1">Output Type</span>
                <span className="text-gray-200">{agent.config.outputType ?? "Free text"}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block mb-1">Created</span>
                <span className="text-gray-200">{new Date(agent.createdAt).toLocaleDateString()}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block mb-1">Last Run</span>
                <span className="text-gray-200">{formatTimestamp(agent.lastRun)}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500 text-xs block mb-1">Handoff Targets</span>
                <span className="text-gray-200">
                  {agent.config.handoffs.length > 0 ? agent.config.handoffs.join(", ") : "None"}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500 text-xs block mb-1">Guardrails</span>
                <span className="text-gray-200">
                  {agent.config.guardrails.length > 0 ? agent.config.guardrails.join(", ") : "None"}
                </span>
              </div>
            </div>
          </section>

          {/* Instructions */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Instructions</h2>
            <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">{agent.config.instructions}</p>
          </section>

          {/* Tools with enable/disable */}
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
              Tools ({agent.config.tools.length})
            </h2>
            <div className="space-y-2">
              {agent.config.tools.map((tool) => (
                <div
                  key={tool.id ?? tool.name}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#1c1c24] border border-[#2a2a33]"
                >
                  <div className="min-w-0">
                    <span className="text-sm text-gray-200 font-medium">{tool.name}</span>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{tool.description}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-3 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={(e) => onToggleTool(agent.id, tool.name, e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#2a2a33] rounded-full peer peer-checked:bg-[#6335e7] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-gray-300 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </div>
              ))}
              {agent.config.tools.length === 0 && (
                <p className="text-xs text-gray-600 py-4 text-center">No tools configured</p>
              )}
            </div>
          </section>
        </div>

        {/* Right: execution history */}
        <div className="space-y-6">
          <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Execution History</h2>
              <span className="text-xs text-gray-500">Last 5 runs</span>
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-gray-600 py-6 text-center">No runs recorded yet</p>
            ) : (
              <div className="space-y-3">
                {history.map((run) => (
                  <div
                    key={run.id}
                    className="p-3 rounded-xl bg-[#1c1c24] border border-[#2a2a33] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">{formatTimestamp(run.timestamp)}</span>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          run.status === "success"
                            ? "text-emerald-400 bg-emerald-400/10"
                            : run.status === "error"
                              ? "text-red-400 bg-red-400/10"
                              : "text-amber-400 bg-amber-400/10"
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{run.input}</p>
                    <div className="flex gap-3 text-[10px] text-gray-600">
                      <span>{run.turns} turns</span>
                      <span>{run.tokens} tokens</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Context metadata */}
          {Object.keys(agent.config.context ?? {}).length > 0 && (
            <section className="bg-[#14141a] border border-[#1e1e24] rounded-2xl p-6 space-y-3">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Context</h2>
              <div className="space-y-1.5">
                {Object.entries(agent.config.context ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">{key}</span>
                    <span className="text-gray-500 font-mono max-w-[60%] truncate">{String(value)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main AgentPage ───────────────────────────────────────────────────

export function AgentPage() {
  const [agents, setAgents] = useState<MockAgent[]>(MOCK_AGENTS);
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [selectedAgent, setSelectedAgent] = useState<MockAgent | null>(null);
  const [editingConfig, setEditingConfig] = useState<AgentConfig | null>(null);

  const allAgentNames = agents.map((a) => a.config.name);

  const handleCreate = useCallback(() => {
    setEditingConfig(blankAgentConfig());
    setSelectedAgent(null);
    setView("form");
  }, []);

  const handleSelect = useCallback((agent: MockAgent) => {
    setSelectedAgent(agent);
    setEditingConfig(null);
    setView("detail");
  }, []);

  const handleEdit = useCallback(() => {
    if (!selectedAgent) return;
    setEditingConfig({ ...selectedAgent.config, tools: selectedAgent.config.tools.map((t) => ({ ...t })) });
    setView("form");
  }, [selectedAgent]);

  const handleSave = useCallback(
    (config: AgentConfig) => {
      if (editingConfig?.name && editingConfig.name !== config.name) {
        // Rename: find and update
        setAgents((prev) =>
          prev.map((a) =>
            a.config.name === editingConfig.name
              ? { ...a, config: { ...config } }
              : a,
          ),
        );
      } else if (!editingConfig?.name) {
        // Create new
        const newAgent: MockAgent = {
          id: `agent-${Date.now()}`,
          config: { ...config },
          status: "idle",
          lastRun: null,
          createdAt: new Date().toISOString(),
        };
        setAgents((prev) => [...prev, newAgent]);
      } else {
        // Update existing by id (from detail view)
        setAgents((prev) =>
          prev.map((a) =>
            a.id === selectedAgent?.id
              ? { ...a, config: { ...config } }
              : a,
          ),
        );
      }
      setView("list");
      setSelectedAgent(null);
      setEditingConfig(null);
    },
    [editingConfig, selectedAgent],
  );

  const handleDelete = useCallback(() => {
    if (!selectedAgent) return;
    setAgents((prev) => prev.filter((a) => a.id !== selectedAgent.id));
    setView("list");
    setSelectedAgent(null);
    setEditingConfig(null);
  }, [selectedAgent]);

  const handleCancel = useCallback(() => {
    if (selectedAgent) {
      setView("detail");
      setEditingConfig(null);
    } else {
      setView("list");
      setEditingConfig(null);
    }
  }, [selectedAgent]);

  const handleToggleTool = useCallback(
    (agentId: string, toolName: string, enabled: boolean) => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agentId
            ? {
                ...a,
                config: {
                  ...a.config,
                  tools: a.config.tools.map((t) =>
                    t.name === toolName ? { ...t, enabled } : t,
                  ),
                },
              }
            : a,
        ),
      );
    },
    [],
  );

  if (view === "form" && editingConfig) {
    return (
      <AgentFormView
        initial={editingConfig}
        allAgentNames={allAgentNames}
        onSave={handleSave}
        onCancel={handleCancel}
        onDelete={selectedAgent ? handleDelete : undefined}
      />
    );
  }

  if (view === "detail" && selectedAgent) {
    return (
      <AgentDetailView
        agent={selectedAgent}
        onEdit={handleEdit}
        onBack={() => {
          setView("list");
          setSelectedAgent(null);
        }}
        onToggleTool={handleToggleTool}
      />
    );
  }

  return (
    <AgentListView
      agents={agents}
      onCreate={handleCreate}
      onSelect={handleSelect}
    />
  );
}
