import React, { useState } from "react";
import { SettingsToggle } from "../components/SettingsComponents";

// ─── Types ────────────────────────────────────────────────────────────

type VectorStoreType = "Qdrant" | "SQLite" | "InMemory";
type VectorStoreStatus = "connected" | "disconnected" | "error";

interface VectorStoreInfo {
  type: VectorStoreType;
  status: VectorStoreStatus;
  dimensionCount: number;
  documentCount: number;
  indexSizeKB: number;
}

interface EmbeddingConfig {
  model: string;
  dimension: number;
  provider: string;
}

interface RAGConfig {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  similarityThreshold: number;
  rerankerEnabled: boolean;
}

interface MemoryTypeConfig {
  key: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
  maxEntries: number;
  ttlMinutes: number | null;
}

interface SearchResult {
  id: string;
  content: string;
  score: number;
  scope: string;
}

// ─── Mock Data (would come from IPC/main process) ─────────────────────

const MOCK_VECTOR_INFO: VectorStoreInfo = {
  type: "Qdrant",
  status: "connected",
  dimensionCount: 1536,
  documentCount: 1_247,
  indexSizeKB: 8_420,
};

const MOCK_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "text-embedding-3-small",
  dimension: 1536,
  provider: "openai",
};

const MOCK_RAG_CONFIG_INITIAL: RAGConfig = {
  chunkSize: 512,
  chunkOverlap: 64,
  topK: 5,
  similarityThreshold: 0.72,
  rerankerEnabled: false,
};

const MOCK_MEMORY_TYPES: MemoryTypeConfig[] = [
  {
    key: "episodic",
    label: "Episodic Memory",
    description: "Conversation history, user interactions, and session context. Retains the flow of past exchanges for continuity.",
    icon: "💬",
    enabled: true,
    maxEntries: 500,
    ttlMinutes: 60 * 24 * 7, // 7 days
  },
  {
    key: "semantic",
    label: "Semantic Memory",
    description: "Knowledge base of facts, concepts, and learned information extracted from interactions and data sources.",
    icon: "🧠",
    enabled: true,
    maxEntries: 10_000,
    ttlMinutes: null, // no expiry
  },
  {
    key: "task",
    label: "Task Memory",
    description: "Execution state, active run context, tool call history, and intermediate results for in-flight operations.",
    icon: "⚡",
    enabled: true,
    maxEntries: 200,
    ttlMinutes: 60 * 6, // 6 hours
  },
];

const MOCK_SEARCH_RESULTS: SearchResult[] = [
  { id: "mem_001", content: "User mentioned they prefer Python for data analysis and have experience with pandas and numpy.", score: 0.94, scope: "semantic" },
  { id: "mem_042", content: "Previous conversation discussed setting up a PostgreSQL database for the analytics pipeline.", score: 0.87, scope: "episodic" },
  { id: "mem_107", content: "Active task: Refactoring the vector store service to support multiple backends via strategy pattern.", score: 0.81, scope: "task" },
  { id: "mem_023", content: "User's preferred editor is VS Code with the Tailwind CSS IntelliSense extension installed.", score: 0.76, scope: "semantic" },
  { id: "mem_202", content: "Tool call: search_files(pattern='*memory*', path='./packages') returned 14 results", score: 0.65, scope: "task" },
  { id: "mem_089", content: "Agent confirmed understanding of the project requirements at 2026-05-10T14:32:00Z", score: 0.59, scope: "episodic" },
];

// ─── Sub-Components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: VectorStoreStatus }) {
  const colors: Record<VectorStoreStatus, string> = {
    connected:
      "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    disconnected:
      "bg-amber-500/10 text-amber-400 border-amber-500/20",
    error:
      "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span
      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${colors[status]}`}
    >
      {status}
    </span>
  );
}

function InfoCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: string;
  label: string;
  value: string | React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl p-4 hover:border-[#6335e7]/30 transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      {typeof value === "string" ? (
        <p className="text-lg font-semibold text-gray-200">{value}</p>
      ) : (
        <div className="text-lg font-semibold text-gray-200">{value}</div>
      )}
      {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          {title}
        </h2>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl overflow-hidden divide-y divide-[#1e1e24]">
        {children}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 hover:bg-[#ffffff06] transition-colors">
      <div className="min-w-0 flex-1 mr-4">
        <p className="text-sm font-medium text-gray-200">{label}</p>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3 min-w-[200px]">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="
            flex-1 h-1 rounded-full appearance-none cursor-pointer
            bg-[#2a2a33]
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-[#a78bfa]
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:shadow-sm
          "
        />
        <span className="text-xs font-mono text-gray-400 w-14 text-right tabular-nums shrink-0">
          {value}{suffix}
        </span>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  beta,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  beta?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 hover:bg-[#ffffff06] transition-colors">
      <div className="min-w-0 flex-1 mr-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-200">{label}</p>
          {beta && (
            <span className="text-[10px] font-medium text-[#a78bfa] bg-[#a78bfa]/10 px-1.5 py-0.5 rounded">
              BETA
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <SettingsToggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ─── Memory Type Row ─────────────────────────────────────────────────

function MemoryTypeRow({
  config,
  onToggle,
  onMaxEntriesChange,
  onTtlChange,
}: {
  config: MemoryTypeConfig;
  onToggle: (v: boolean) => void;
  onMaxEntriesChange: (v: number) => void;
  onTtlChange: (v: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-3.5 hover:bg-[#ffffff06] transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
          <span className="text-lg shrink-0">{config.icon}</span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-200">{config.label}</p>
              <span className="text-[10px] font-mono text-gray-500 bg-[#1e1e24] px-1.5 py-0.5 rounded">
                {config.key}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 max-w-md">
              {config.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path
                d="M4 5.5L7 8.5L10 5.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <SettingsToggle checked={config.enabled} onChange={onToggle} />
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-11 pl-4 border-l border-[#2a2a33] space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500">
                Max Entries
              </label>
              <input
                type="number"
                min={1}
                value={config.maxEntries}
                onChange={(e) => onMaxEntriesChange(Math.max(1, Number(e.target.value)))}
                disabled={!config.enabled}
                className="
                  w-20 text-[11px] font-mono bg-[#1e1e24] border border-[#2a2a33]
                  text-gray-200 rounded px-2 py-1 outline-none
                  focus:border-[#a78bfa]/50 disabled:opacity-40
                "
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500">TTL</label>
              <select
                value={config.ttlMinutes === null ? "forever" : String(config.ttlMinutes)}
                onChange={(e) => {
                  const v = e.target.value;
                  onTtlChange(v === "forever" ? null : Number(v));
                }}
                disabled={!config.enabled}
                className="
                  text-[11px] bg-[#1e1e24] border border-[#2a2a33] text-gray-200
                  rounded px-2 py-1 outline-none focus:border-[#a78bfa]/50
                  disabled:opacity-40
                "
              >
                <option value="forever">No Expiry</option>
                <option value="60">1 Hour</option>
                <option value="360">6 Hours</option>
                <option value="1440">24 Hours</option>
                <option value="10080">7 Days</option>
                <option value="43200">30 Days</option>
              </select>
            </div>
          </div>
          <div className="text-[11px] text-gray-600">
            {config.ttlMinutes === null
              ? "Entries stored indefinitely"
              : `Entries auto-expire after ${config.ttlMinutes >= 1440
                  ? `${Math.round(config.ttlMinutes / 1440)} days`
                  : config.ttlMinutes >= 60
                    ? `${Math.round(config.ttlMinutes / 60)} hours`
                    : `${config.ttlMinutes} minutes`
                }`}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Search Test ──────────────────────────────────────────────────────

function SearchTestSection() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = () => {
    if (!query.trim()) return;
    const q = query.toLowerCase();
    const filtered = MOCK_SEARCH_RESULTS.filter(
      (r) =>
        r.content.toLowerCase().includes(q) ||
        r.id.includes(q) ||
        r.scope.includes(q),
    ).sort((a, b) => b.score - a.score);
    setResults(filtered);
    setSearched(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <SectionCard title="Search Test" description="Query the vector store to test retrieval and ranking">
      <div className="px-5 py-3.5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
            >
              <circle
                cx="5.5"
                cy="5.5"
                r="4"
                stroke="currentColor"
                strokeWidth="1.2"
                className="text-gray-500"
              />
              <path
                d="M8.5 8.5L11 11"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                className="text-gray-500"
              />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search vector store (e.g. 'python', 'database', 'task')..."
              className="
                w-full text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200
                rounded-lg pl-8 pr-3 py-2 outline-none
                focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20
              "
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={!query.trim()}
            className="
              text-xs font-medium text-white bg-[#a78bfa] hover:bg-[#b99cfb]
              px-4 py-2 rounded-lg transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            Search
          </button>
        </div>

        {searched && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-gray-500">
              {results.length === 0
                ? "No results found."
                : `Found ${results.length} result${results.length === 1 ? "" : "s"}:`}
            </p>
            {results.map((r) => (
              <div
                key={r.id}
                className="
                  flex items-start gap-3 bg-[#1e1e24] border border-[#2a2a33]
                  rounded-lg p-3 hover:border-[#6335e7]/30 transition-colors
                "
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-[#a78bfa]">
                      {r.id}
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                      {r.scope}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {r.content}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`text-[11px] font-mono font-semibold ${
                      r.score >= 0.85
                        ? "text-emerald-400"
                        : r.score >= 0.7
                          ? "text-amber-400"
                          : "text-gray-500"
                    }`}
                  >
                    {(r.score * 100).toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    score
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Main MemoryPage ──────────────────────────────────────────────────

export function MemoryPage() {
  const [ragConfig, setRagConfig] = useState<RAGConfig>(MOCK_RAG_CONFIG_INITIAL);

  const updateRAG = <K extends keyof RAGConfig>(
    key: K,
    value: RAGConfig[K],
  ) => {
    setRagConfig((prev) => ({ ...prev, [key]: value }));
  };

  const [memoryTypes, setMemoryTypes] = useState<MemoryTypeConfig[]>(
    MOCK_MEMORY_TYPES,
  );

  const updateMemoryType = (
    key: string,
    field: keyof MemoryTypeConfig,
    value: boolean | number | null,
  ) => {
    setMemoryTypes((prev) =>
      prev.map((mt) => (mt.key === key ? { ...mt, [field]: value } : mt)),
    );
  };

  return (
    <div className="memory-page h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-8 pt-8 pb-6">
        <h1 className="text-3xl font-bold text-gray-100 mb-2">
          Memory Systems
        </h1>
        <p className="text-gray-500 text-sm">
          Manage agent memory, knowledge bases, vector stores, and RAG
          configuration
        </p>
      </div>

      {/* ── Scrollable Content ── */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-4xl">
          {/* ═══════════════════════════════════════════════════════
              1. SYSTEM OVERVIEW
             ═══════════════════════════════════════════════════════ */}
          <SectionCard
            title="System Overview"
            description="Vector store and embedding model status"
          >
            <div className="px-5 py-4">
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Vector Store
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <InfoCard
                  icon="🗄️"
                  label="Type"
                  value={MOCK_VECTOR_INFO.type}
                />
                <InfoCard
                  icon="🔗"
                  label="Status"
                  value={
                    <div className="flex items-center gap-2">
                      <StatusBadge status={MOCK_VECTOR_INFO.status} />
                    </div>
                  }
                />
                <InfoCard
                  icon="📐"
                  label="Dimensions"
                  value={String(MOCK_VECTOR_INFO.dimensionCount)}
                />
                <InfoCard
                  icon="📄"
                  label="Documents"
                  value={String(MOCK_VECTOR_INFO.documentCount)}
                  sub={`${MOCK_VECTOR_INFO.indexSizeKB.toLocaleString()} KB index`}
                />
              </div>
            </div>
          </SectionCard>

          {/* ═══════════════════════════════════════════════════════
              2. RAG CONFIGURATION
             ═══════════════════════════════════════════════════════ */}
          <SectionCard
            title="RAG Configuration"
            description="Chunking, retrieval, and reranking settings for retrieval-augmented generation"
          >
            <SliderRow
              label="Chunk Size"
              description="Number of tokens per document chunk"
              value={ragConfig.chunkSize}
              min={128}
              max={2048}
              step={64}
              suffix="t"
              onChange={(v) => updateRAG("chunkSize", v)}
            />
            <SliderRow
              label="Chunk Overlap"
              description="Token overlap between adjacent chunks for context continuity"
              value={ragConfig.chunkOverlap}
              min={0}
              max={512}
              step={16}
              suffix="t"
              onChange={(v) => updateRAG("chunkOverlap", v)}
            />
            <SliderRow
              label="Top-K Retrieval"
              description="Number of top results to retrieve per query"
              value={ragConfig.topK}
              min={1}
              max={50}
              onChange={(v) => updateRAG("topK", v)}
            />
            <SliderRow
              label="Similarity Threshold"
              description="Minimum cosine similarity score for retrieval (0.0 = accept all)"
              value={Math.round(ragConfig.similarityThreshold * 100)}
              min={0}
              max={100}
              suffix="%"
              onChange={(v) => updateRAG("similarityThreshold", v / 100)}
            />
            <ToggleRow
              label="Reranker"
              description="Apply a cross-encoder reranker to refine retrieved results"
              checked={ragConfig.rerankerEnabled}
              onChange={(v) => updateRAG("rerankerEnabled", v)}
              beta
            />
          </SectionCard>

          {/* ═══════════════════════════════════════════════════════
              3. MEMORY TYPES
             ═══════════════════════════════════════════════════════ */}
          <SectionCard
            title="Memory Types"
            description="Enable, disable, and configure each memory scope"
          >
            {memoryTypes.map((mt) => (
              <MemoryTypeRow
                key={mt.key}
                config={mt}
                onToggle={(v) => updateMemoryType(mt.key, "enabled", v)}
                onMaxEntriesChange={(v) =>
                  updateMemoryType(mt.key, "maxEntries", v)
                }
                onTtlChange={(v) => updateMemoryType(mt.key, "ttlMinutes", v)}
              />
            ))}
          </SectionCard>

          {/* ═══════════════════════════════════════════════════════
              4. SEARCH TEST
             ═══════════════════════════════════════════════════════ */}
          <SearchTestSection />
        </div>
      </div>
    </div>
  );
}
