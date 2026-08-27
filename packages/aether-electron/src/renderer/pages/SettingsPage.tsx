import React, { useState } from "react";
import {
  SettingsSection,
  SettingsRow,
  SettingsToggle,
  SettingsSelect,
  SettingsInput,
  SettingsSlider,
  SettingsButton,
  SettingsKeyValueEditor,
  type KeyValuePair,
} from "../components/SettingsComponents";
import { useSettingsStore } from "../stores/settingsStore";

// ─── Type helpers ──────────────────────────────────────────────

type ChunkingStrategy = "fixed" | "sentence" | "paragraph" | "semantic";

// ─── Option tables ─────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const AUTO_START_OPTIONS = [
  { value: "disabled", label: "Disabled" },
  { value: "minimized", label: "Start Minimized" },
  { value: "hidden", label: "Start Hidden" },
];

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
  { value: "ollama", label: "Ollama" },
  { value: "mistral", label: "Mistral" },
  { value: "cohere", label: "Cohere" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "xai", label: "xAI" },
];

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { value: "claude-sonnet-4.6-20250717", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-3.5-20241022", label: "Claude Haiku 3.5" },
  ],
  google: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  ollama: [
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "mistral", label: "Mistral" },
    { value: "codellama", label: "CodeLlama" },
  ],
  mistral: [
    { value: "mistral-large", label: "Mistral Large" },
    { value: "mistral-small", label: "Mistral Small" },
  ],
  cohere: [
    { value: "command-r-plus", label: "Command R+" },
    { value: "command-r", label: "Command R" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat" },
    { value: "deepseek-coder", label: "DeepSeek Coder" },
  ],
  xai: [
    { value: "grok-3", label: "Grok 3" },
    { value: "grok-3-mini", label: "Grok 3 Mini" },
  ],
};

const VECTOR_STORE_OPTIONS = [
  { value: "sqlite", label: "SQLite (built-in)" },
  { value: "qdrant", label: "Qdrant" },
  { value: "pgvector", label: "pgvector" },
  { value: "chroma", label: "Chroma" },
  { value: "pinecone", label: "Pinecone" },
];

const EMBEDDING_MODEL_OPTIONS = [
  { value: "text-embedding-ada-002", label: "OpenAI Ada 002" },
  { value: "text-embedding-3-small", label: "OpenAI v3 Small" },
  { value: "text-embedding-3-large", label: "OpenAI v3 Large" },
  { value: "multilingual-e5-large", label: "E5 Multilingual" },
  { value: "bge-base-en-v1.5", label: "BGE Base EN" },
  { value: "all-MiniLM-L6-v2", label: "MiniLM L6 v2" },
];

const CHUNK_OPTIONS = [
  { value: "fixed", label: "Fixed Size" },
  { value: "sentence", label: "Sentence" },
  { value: "paragraph", label: "Paragraph" },
  { value: "semantic", label: "Semantic" },
];

const UPDATE_CHANNEL_OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
  { value: "dev", label: "Dev" },
];

// ─── Sub-components ────────────────────────────────────────────

function ApiKeysEditor() {
  const settings = useSettingsStore((s) => s.settings);
  const updateProviders = useSettingsStore((s) => s.updateProviders);
  const [keys, setKeys] = useState<KeyValuePair[]>(() =>
    Object.entries(settings.providers.apiKeys).map(([k, v]) => ({ key: k, value: v })),
  );

  const handleChange = (pairs: KeyValuePair[]) => {
    setKeys(pairs);
    const apiKeys: Record<string, string> = {};
    for (const p of pairs) {
      if (p.key.trim()) apiKeys[p.key.trim()] = p.value;
    }
    updateProviders({ apiKeys });
  };

  return (
    <SettingsKeyValueEditor
      pairs={keys}
      onChange={handleChange}
      keyPlaceholder="Provider"
      valuePlaceholder="API Key"
    />
  );
}

function CustomHeadersEditor() {
  const settings = useSettingsStore((s) => s.settings);
  const updateProviders = useSettingsStore((s) => s.updateProviders);
  const [headers, setHeaders] = useState<KeyValuePair[]>(() =>
    Object.entries(settings.providers.customHeaders).map(([k, v]) => ({ key: k, value: v })),
  );

  const handleChange = (pairs: KeyValuePair[]) => {
    setHeaders(pairs);
    const customHeaders: Record<string, string> = {};
    for (const p of pairs) {
      if (p.key.trim()) customHeaders[p.key.trim()] = p.value;
    }
    updateProviders({ customHeaders });
  };

  return (
    <SettingsKeyValueEditor
      pairs={headers}
      onChange={handleChange}
      keyPlaceholder="Header"
      valuePlaceholder="Value"
    />
  );
}

function McpServersEditor() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSecurity = useSettingsStore((s) => s.updateSecurity);
  const servers = settings.security.mcpServers;
  const [localServers, setLocalServers] = useState(servers);

  const update = (idx: number, field: string, val: string) => {
    const next = localServers.map((s, i) =>
      i === idx ? { ...s, [field]: val } : s,
    );
    setLocalServers(next);
    updateSecurity({ mcpServers: next });
  };

  const remove = (idx: number) => {
    const next = localServers.filter((_, i) => i !== idx);
    setLocalServers(next);
    updateSecurity({ mcpServers: next });
  };

  const add = () => {
    const next = [...localServers, { id: "", name: "", command: "", args: [] }];
    setLocalServers(next);
    updateSecurity({ mcpServers: next });
  };

  return (
    <div className="flex flex-col gap-2 min-w-[300px]">
      {localServers.map((srv, i) => (
        <div key={i} className="bg-[#1e1e24] rounded-lg p-3 border border-[#2a2a33] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-gray-400">MCP Server #{i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-[11px] text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SettingsInput
              value={srv.id}
              onChange={(v) => update(i, "id", v)}
              placeholder="Server ID"
              width="w-full"
            />
            <SettingsInput
              value={srv.name}
              onChange={(v) => update(i, "name", v)}
              placeholder="Display Name"
              width="w-full"
            />
            <SettingsInput
              value={srv.command}
              onChange={(v) => update(i, "command", v)}
              placeholder="Command (e.g. npx)"
              width="w-full"
            />
            <SettingsInput
              value={srv.args.join(" ")}
              onChange={(v) => update(i, "args", v)}
              placeholder="Arguments (space-separated)"
              width="w-full"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors self-start"
      >
        + Add MCP server
      </button>
    </div>
  );
}

function AllowedPathsEditor() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSecurity = useSettingsStore((s) => s.updateSecurity);
  const [paths, setPaths] = useState(settings.security.allowedPaths.join("\n"));

  return (
    <div className="min-w-[200px]">
      <textarea
        value={paths}
        onChange={(e) => {
          setPaths(e.target.value);
          updateSecurity({
            allowedPaths: e.target.value.split("\n").map((p) => p.trim()).filter(Boolean),
          });
        }}
        placeholder="/home/nekophobia/projects\n/tmp"
        rows={3}
        className="w-full text-xs font-mono bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg
          px-3 py-1.5 outline-none focus:border-[#a78bfa]/50 resize-y min-h-[60px]"
      />
    </div>
  );
}

function DeniedCommandsEditor() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSecurity = useSettingsStore((s) => s.updateSecurity);
  const [cmds, setCmds] = useState(settings.security.deniedCommands.join("\n"));

  return (
    <div className="min-w-[200px]">
      <textarea
        value={cmds}
        onChange={(e) => {
          setCmds(e.target.value);
          updateSecurity({
            deniedCommands: e.target.value.split("\n").map((c) => c.trim()).filter(Boolean),
          });
        }}
        placeholder="rm -rf\nshutdown\nreboot"
        rows={3}
        className="w-full text-xs font-mono bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg
          px-3 py-1.5 outline-none focus:border-[#a78bfa]/50 resize-y min-h-[60px]"
      />
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────

export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const updateGeneral = useSettingsStore((s) => s.updateGeneral);
  const updateProviders = useSettingsStore((s) => s.updateProviders);
  const updateMemory = useSettingsStore((s) => s.updateMemory);
  const updateExecution = useSettingsStore((s) => s.updateExecution);
  const updateSecurity = useSettingsStore((s) => s.updateSecurity);
  const updateOrchestration = useSettingsStore((s) => s.updateOrchestration);
  const updateGUI = useSettingsStore((s) => s.updateGUI);
  const resetAll = useSettingsStore((s) => s.resetAll);
  const isDirty = useSettingsStore((s) => s.isDirty);
  const saveSettings = useSettingsStore((s) => s.saveSettings);

  const [searchQuery, setSearchQuery] = useState("");

  // ── Local state for sections not backed by the store ──────────
  const [defaultModel, setDefaultModel] = useState("gpt-4o");
  const [maxRetries, setMaxRetries] = useState(3);
  const [requestTimeout, setRequestTimeout] = useState(60);
  const [autoCheckpoint, setAutoCheckpoint] = useState(true);
  const [vaultEncryption, setVaultEncryption] = useState(true);
  const [auditLogging, setAuditLogging] = useState(false);
  const [corsOrigins, setCorsOrigins] = useState("http://localhost:5173");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [updateChannel, setUpdateChannel] = useState("stable");
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const g = settings.general;
  const p = settings.providers;
  const m = settings.memory;
  const e = settings.execution;
  const sec = settings.security;

  // ── About info (static) ──────────────────────────────────────
  const about = {
    version: "v1.0.0-beta.2",
    electron: "33.3.1",
    chrome: "130.0.6723.152",
    node: "20.18.0",
    license: "MIT License",
    repoUrl: "https://github.com/aether-platform/aether",
  };

  const handleCheckUpdate = () => {
    setCheckingUpdate(true);
    // Simulate update check
    setTimeout(() => setCheckingUpdate(false), 2000);
  };

  return (
    <div className="settings-page h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-8 pt-8 pb-4 border-b border-[#1e1e24]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-100">Settings</h1>
            <p className="text-gray-500 text-sm mt-1">
              Configure every aspect of the Aether platform
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-[11px] text-amber-400 bg-amber-400/10 px-2 py-1 rounded">
                Unsaved changes
              </span>
            )}
            <SettingsButton label="Reset All" onClick={resetAll} variant="danger" />
            <SettingsButton label="Save Settings" onClick={saveSettings} variant="primary" />
          </div>
        </div>
        <div className="relative max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search settings..."
            className="w-full text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg
              pl-8 pr-3 py-1.5 outline-none focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            width="12" height="12" viewBox="0 0 12 12" fill="none"
          >
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" className="text-gray-500" />
            <path d="M8.5 8.5L11 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-gray-500" />
          </svg>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl space-y-2">

          {/* ═══════════════════════════════════════════════════════════
              1. GENERAL - Theme, Language, Auto-Start, Minimize to Tray
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection title="General" description="Application appearance, startup, and interface preferences">
            <SettingsRow label="Theme" description="Light, dark, or follow system preference">
              <SettingsSelect
                value={g.theme}
                options={THEME_OPTIONS}
                onChange={(v) => updateGeneral({ theme: v as "dark" | "light" | "system" })}
              />
            </SettingsRow>
            <SettingsRow label="Language" description="Interface language for the application">
              <SettingsSelect
                value={g.language}
                options={LANGUAGE_OPTIONS}
                onChange={(v) => updateGeneral({ language: v })}
              />
            </SettingsRow>
            <SettingsRow label="Auto-Start" description="Automatically launch Aether on system startup">
              <SettingsSelect
                value={g.startupBehavior}
                options={AUTO_START_OPTIONS}
                onChange={(v) => updateGeneral({ startupBehavior: v as "restore" | "minimized" | "hidden" })}
              />
            </SettingsRow>
            <SettingsRow label="Minimize to Tray" description="Close button minimizes to system tray instead of quitting">
              <SettingsToggle
                checked={g.minimizeToTray}
                onChange={(v) => updateGeneral({ minimizeToTray: v })}
              />
            </SettingsRow>
            <SettingsRow label="Compact Mode" description="Reduce padding and spacing throughout the UI">
              <SettingsToggle
                checked={settings.gui.compactMode}
                onChange={(v) => updateGUI({ compactMode: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              2. AI PROVIDERS - Default Provider, Default Model, Max Retries, Timeout
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="AI Providers"
            description="Configure provider selection, model defaults, and request behavior"
          >
            <SettingsRow label="Default Provider" description="Primary AI provider for agent requests">
              <SettingsSelect
                value={p.defaultProvider}
                options={PROVIDER_OPTIONS}
                onChange={(v) => updateProviders({ defaultProvider: v })}
              />
            </SettingsRow>
            <SettingsRow label="Default Model" description="Default model to use for the selected provider">
              <SettingsSelect
                value={defaultModel}
                options={MODEL_OPTIONS[p.defaultProvider] || MODEL_OPTIONS.openai}
                onChange={(v) => setDefaultModel(v)}
              />
            </SettingsRow>
            <SettingsRow label="Max Retries" description="Maximum number of retry attempts on request failure">
              <SettingsSlider
                value={maxRetries}
                min={0}
                max={10}
                suffix="x"
                onChange={(v) => setMaxRetries(v)}
              />
            </SettingsRow>
            <SettingsRow label="Request Timeout" description="Timeout in seconds for provider API requests">
              <SettingsSlider
                value={requestTimeout}
                min={10}
                max={300}
                step={10}
                suffix="s"
                onChange={(v) => setRequestTimeout(v)}
              />
            </SettingsRow>
            <SettingsRow label="Rate Limit — RPM" description="Max requests per minute per provider">
              <SettingsSlider
                value={p.rateLimits.requestsPerMinute}
                min={1}
                max={1000}
                step={10}
                suffix=" rpm"
                onChange={(v) => updateProviders({ rateLimits: { ...p.rateLimits, requestsPerMinute: v } })}
              />
            </SettingsRow>
            <SettingsRow label="API Keys" description="Manage provider API credentials" beta>
              <ApiKeysEditor />
            </SettingsRow>
            <SettingsRow label="Custom Headers" description="Additional HTTP headers for provider requests" beta>
              <CustomHeadersEditor />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              3. EXECUTION - Max Parallel, Default Max Turns, Timeout, Auto-Checkpoint
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="Execution"
            description="Agent execution concurrency, turn limits, timeouts, and checkpointing"
          >
            <SettingsRow label="Max Parallel Executions" description="Maximum number of agents executing simultaneously">
              <SettingsSlider
                value={e.maxConcurrent}
                min={1}
                max={64}
                suffix=" agents"
                onChange={(v) => updateExecution({ maxConcurrent: v })}
              />
            </SettingsRow>
            <SettingsRow label="Default Max Turns" description="Maximum turns per agent session before forced stop">
              <SettingsSlider
                value={settings.orchestration.defaultMaxTurns}
                min={5}
                max={200}
                step={5}
                suffix=" turns"
                onChange={(v) => updateOrchestration({ defaultMaxTurns: v })}
              />
            </SettingsRow>
            <SettingsRow label="Execution Timeout" description="Max wall-clock time per agent execution (seconds)">
              <SettingsSlider
                value={e.defaultTimeout}
                min={30}
                max={3600}
                step={30}
                suffix="s"
                onChange={(v) => updateExecution({ defaultTimeout: v })}
              />
            </SettingsRow>
            <SettingsRow label="Auto-Checkpoint" description="Automatically save execution state at intervals">
              <SettingsToggle
                checked={autoCheckpoint}
                onChange={(v) => setAutoCheckpoint(v)}
              />
            </SettingsRow>
            {autoCheckpoint && (
              <SettingsRow label="Checkpoint Interval" description="Seconds between automatic state checkpoints">
                <SettingsSlider
                  value={settings.orchestration.checkpointInterval}
                  min={5}
                  max={300}
                  step={5}
                  suffix="s"
                  onChange={(v) => updateOrchestration({ checkpointInterval: v })}
                />
              </SettingsRow>
            )}
            <SettingsRow label="Max Retries" description="Max per-step retries before marking task as failed">
              <SettingsSlider
                value={e.maxRetries}
                min={0}
                max={20}
                suffix="x"
                onChange={(v) => updateExecution({ maxRetries: v })}
              />
            </SettingsRow>
            <SettingsRow label="Parallel Steps" description="Enable parallel step execution in workflows">
              <SettingsToggle
                checked={e.enableParallelSteps}
                onChange={(v) => updateExecution({ enableParallelSteps: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              4. MEMORY - Vector Store, Embedding Model, Chunk Size, Overlap
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="Memory"
            description="Vector database, embedding configuration, and retrieval settings"
          >
            <SettingsRow label="Memory System" description="Enable persistent memory and RAG for agents">
              <SettingsToggle
                checked={m.memoryEnabled}
                onChange={(v) => updateMemory({ memoryEnabled: v })}
              />
            </SettingsRow>
            {m.memoryEnabled && (
              <>
                <SettingsRow label="Vector Store Type" description="Backend database for vector embeddings">
                  <SettingsSelect
                    value={m.storageType}
                    options={VECTOR_STORE_OPTIONS}
                    onChange={(v) => updateMemory({ storageType: v as "sqlite" | "qdrant" | "postgres" | "memory" })}
                  />
                </SettingsRow>
                {(m.storageType === "qdrant" || m.storageType === "postgres") && (
                  <SettingsRow label="Vector DB URL" description="Connection string for external vector database">
                    <SettingsInput
                      value={m.vectorDbUrl}
                      onChange={(v) => updateMemory({ vectorDbUrl: v })}
                      placeholder="http://localhost:6333"
                      monospace
                      width="min-w-[260px]"
                    />
                  </SettingsRow>
                )}
                <SettingsRow label="Collection Name" description="Vector collection or table name">
                  <SettingsInput
                    value={m.collectionName}
                    onChange={(v) => updateMemory({ collectionName: v })}
                    placeholder="aether_memories"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Embedding Provider" description="Provider service for text embeddings">
                  <SettingsInput
                    value={m.embeddingProvider}
                    onChange={(v) => updateMemory({ embeddingProvider: v })}
                    placeholder="openai"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Embedding Model" description="Model used to generate embeddings">
                  <SettingsSelect
                    value={m.embeddingModel}
                    options={EMBEDDING_MODEL_OPTIONS}
                    onChange={(v) => updateMemory({ embeddingModel: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Chunk Size" description="Maximum tokens per document chunk">
                  <SettingsSlider
                    value={m.maxChunkSize}
                    min={128}
                    max={8192}
                    step={128}
                    suffix=" tokens"
                    onChange={(v) => updateMemory({ maxChunkSize: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Chunk Overlap" description="Token overlap between consecutive chunks">
                  <SettingsSlider
                    value={m.chunkOverlap}
                    min={0}
                    max={1024}
                    step={32}
                    suffix=" tokens"
                    onChange={(v) => updateMemory({ chunkOverlap: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Chunking Strategy" description="Algorithm for splitting documents">
                  <SettingsSelect
                    value={m.chunkingStrategy}
                    options={CHUNK_OPTIONS}
                    onChange={(v) => updateMemory({ chunkingStrategy: v as ChunkingStrategy })}
                  />
                </SettingsRow>
                <SettingsRow label="Top-K Results" description="Number of retrieved chunks per query">
                  <SettingsSlider
                    value={m.topK}
                    min={1}
                    max={100}
                    suffix=" docs"
                    onChange={(v) => updateMemory({ topK: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Min Score Threshold" description="Minimum similarity score for retrieval">
                  <SettingsSlider
                    value={m.minScore * 100}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    onChange={(v) => updateMemory({ minScore: v / 100 })}
                  />
                </SettingsRow>
                <SettingsRow label="Embedding Dimension" description="Output dimension of embedding vectors">
                  <SettingsSlider
                    value={m.embeddingDimension}
                    min={64}
                    max={4096}
                    step={64}
                    suffix="d"
                    onChange={(v) => updateMemory({ embeddingDimension: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Reranking" description="Re-rank retrieved results with a cross-encoder">
                  <SettingsToggle
                    checked={m.rerankEnabled}
                    onChange={(v) => updateMemory({ rerankEnabled: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Hybrid Search" description="Combine keyword + vector search" beta>
                  <SettingsToggle
                    checked={m.hybridSearchEnabled}
                    onChange={(v) => updateMemory({ hybridSearchEnabled: v })}
                  />
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              5. SECURITY - API Key Vault Encryption, RBAC, Audit Logging
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="Security"
            description="Access control, credential management, and audit trail settings"
          >
            <SettingsRow label="API Key Vault Encryption" description="Encrypt stored API keys at rest using system keychain">
              <SettingsToggle
                checked={vaultEncryption}
                onChange={(v) => setVaultEncryption(v)}
              />
            </SettingsRow>
            <SettingsRow label="RBAC" description="Role-based access control for multi-user setups" beta>
              <SettingsToggle
                checked={sec.rbacEnabled}
                onChange={(v) => updateSecurity({ rbacEnabled: v })}
              />
            </SettingsRow>
            <SettingsRow label="Audit Logging" description="Record all security-relevant events to the audit log">
              <SettingsToggle
                checked={auditLogging}
                onChange={(v) => setAuditLogging(v)}
              />
            </SettingsRow>
            <SettingsRow label="MCP Server" description="Model Context Protocol server for external tools" beta>
              <SettingsToggle
                checked={sec.mcpServerEnabled}
                onChange={(v) => updateSecurity({ mcpServerEnabled: v })}
              />
            </SettingsRow>
            {sec.mcpServerEnabled && (
              <SettingsRow label="MCP Servers" description="Configure MCP server endpoints">
                <McpServersEditor />
              </SettingsRow>
            )}
            <SettingsRow label="Allowed Paths" description="Filesystem paths agents are allowed to access">
              <AllowedPathsEditor />
            </SettingsRow>
            <SettingsRow label="Denied Commands" description="Shell commands agents are forbidden from running">
              <DeniedCommandsEditor />
            </SettingsRow>
            <SettingsRow label="Sandbox Execution" description="Force all agent shell execution into sandbox">
              <SettingsToggle
                checked={sec.sandboxExecution}
                onChange={(v) => updateSecurity({ sandboxExecution: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              6. NETWORK - Backend Port, Host Binding, CORS Origins
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="Network"
            description="Backend server binding, port configuration, and CORS settings"
          >
            <SettingsRow label="Backend Port" description="TCP port for the Aether backend server">
              <SettingsSlider
                value={g.port}
                min={1024}
                max={65535}
                onChange={(v) => updateGeneral({ port: v })}
              />
            </SettingsRow>
            <SettingsRow label="Host Binding" description="Network interface to bind the backend server to">
              <SettingsSelect
                value={g.host}
                options={[
                  { value: "127.0.0.1", label: "localhost (127.0.0.1)" },
                  { value: "0.0.0.0", label: "All interfaces (0.0.0.0)" },
                  { value: "::1", label: "IPv6 localhost (::1)" },
                ]}
                onChange={(v) => updateGeneral({ host: v })}
              />
            </SettingsRow>
            <SettingsRow label="CORS Origins" description="Allowed CORS origins (comma-separated)">
              <SettingsInput
                value={corsOrigins}
                onChange={(v) => setCorsOrigins(v)}
                placeholder="http://localhost:5173, https://app.aether.dev"
                monospace
                width="min-w-[260px]"
              />
            </SettingsRow>
            <SettingsRow label="Data Directory" description="Path to store persistent server data">
              <SettingsInput
                value={g.dataDir}
                onChange={(v) => updateGeneral({ dataDir: v })}
                placeholder="./data"
                monospace
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              7. UPDATES - Auto-Update, Channel, Check Now
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="Updates"
            description="Software update settings and version channel selection"
          >
            <SettingsRow label="Auto-Update" description="Automatically download and install updates">
              <SettingsToggle
                checked={autoUpdate}
                onChange={(v) => setAutoUpdate(v)}
              />
            </SettingsRow>
            <SettingsRow label="Update Channel" description="Release channel to receive updates from">
              <SettingsSelect
                value={updateChannel}
                options={UPDATE_CHANNEL_OPTIONS}
                onChange={(v) => setUpdateChannel(v)}
              />
            </SettingsRow>
            <SettingsRow
              label="Check for Updates"
              description="Manually check if a newer version is available"
            >
              <SettingsButton
                label={checkingUpdate ? "Checking..." : "Check Now"}
                onClick={handleCheckUpdate}
                variant="primary"
                disabled={checkingUpdate}
              />
            </SettingsRow>
            {checkingUpdate && (
              <div className="px-5 py-2">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" />
                  </svg>
                  Checking for updates...
                </div>
              </div>
            )}
            {!checkingUpdate && (
              <div className="px-5 py-2 text-[11px] text-gray-500">
                Current version: {about.version} ({updateChannel} channel)
              </div>
            )}
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════════
              8. ABOUT - Version, Electron, Chrome, Node, License, Repo
             ═══════════════════════════════════════════════════════════ */}
          <SettingsSection
            title="About"
            description="Application information and version details"
          >
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#a78bfa]/20 flex items-center justify-center shrink-0">
                  <span className="text-lg font-bold text-[#a78bfa]">A</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">Aether Platform</h3>
                  <p className="text-[11px] text-gray-500">Agent orchestration & execution engine</p>
                </div>
                <span className="ml-auto text-xs font-mono text-[#a78bfa] bg-[#a78bfa]/10 px-2 py-0.5 rounded">
                  {about.version}
                </span>
              </div>

              <div className="border-t border-[#1e1e24]" />

              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                <div>
                  <span className="text-[11px] text-gray-500">Version</span>
                  <p className="text-xs font-mono text-gray-300 mt-0.5">{about.version}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Electron</span>
                  <p className="text-xs font-mono text-gray-300 mt-0.5">{about.electron}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Chrome</span>
                  <p className="text-xs font-mono text-gray-300 mt-0.5">{about.chrome}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Node.js</span>
                  <p className="text-xs font-mono text-gray-300 mt-0.5">{about.node}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">License</span>
                  <p className="text-xs font-mono text-gray-300 mt-0.5">{about.license}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500">Repository</span>
                  <a
                    href={about.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#a78bfa] hover:text-[#c4b5fd] transition-colors mt-0.5 block"
                  >
                    {about.repoUrl}
                  </a>
                </div>
              </div>

              <div className="border-t border-[#1e1e24]" />

              <div className="text-[11px] text-gray-500 leading-relaxed">
                Aether is an open-source agent orchestration platform. Built with Electron, React,
                and TypeScript. Licensed under the MIT License.
              </div>
            </div>
          </SettingsSection>

          {/* ── Bottom padding ── */}
          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
