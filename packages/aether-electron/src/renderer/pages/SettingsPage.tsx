import React, { useState } from "react";
import {
  SettingsSection,
  SettingsRow,
  SettingsToggle,
  SettingsSelect,
  SettingsInput,
  SettingsSlider,
  SettingsButton,
  SettingsTagGroup,
  SettingsKeyValueEditor,
  type KeyValuePair,
} from "../components/SettingsComponents";
import { useSettingsStore } from "../stores/settingsStore";

// ─── Mapped types for form state ─────────────────────────────────

type ChunkingStrategy = "fixed" | "sentence" | "paragraph" | "semantic";
type BackoffType = "fixed" | "exponential" | "linear";
type DeploymentTarget = "local" | "docker" | "kubernetes" | "cloud";
type EvalFrequency = "manual" | "per-commit" | "daily" | "weekly";
type NetworkMode = "bridge" | "host" | "none";

// ─── Helpers ─────────────────────────────────────────────────────

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

const STARTUP_OPTIONS = [
  { value: "restore", label: "Restore previous session" },
  { value: "minimized", label: "Start minimized" },
  { value: "hidden", label: "Start hidden" },
];

const STORAGE_OPTIONS = [
  { value: "sqlite", label: "SQLite" },
  { value: "qdrant", label: "Qdrant" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "memory", label: "In-Memory" },
];

const CHUNK_OPTIONS = [
  { value: "fixed", label: "Fixed Size" },
  { value: "sentence", label: "Sentence" },
  { value: "paragraph", label: "Paragraph" },
  { value: "semantic", label: "Semantic" },
];

const BACKOFF_OPTIONS = [
  { value: "exponential", label: "Exponential" },
  { value: "linear", label: "Linear" },
  { value: "fixed", label: "Fixed" },
];

const LOG_LEVEL_OPTIONS = [
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warning" },
  { value: "error", label: "Error" },
];

const NETWORK_OPTIONS = [
  { value: "bridge", label: "Bridge" },
  { value: "host", label: "Host" },
  { value: "none", label: "None" },
];

const DEPLOY_TARGET_OPTIONS = [
  { value: "local", label: "Local" },
  { value: "docker", label: "Docker" },
  { value: "kubernetes", label: "Kubernetes" },
  { value: "cloud", label: "Cloud" },
];

const EVAL_METRIC_OPTIONS = [
  { value: "accuracy", label: "Accuracy" },
  { value: "bleu", label: "BLEU" },
  { value: "rouge", label: "ROUGE" },
  { value: "custom", label: "Custom" },
];

const EVAL_FREQUENCY_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "per-commit", label: "Per Commit" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const PROVIDER_TAGS = ["openai", "anthropic", "ollama", "google", "mistral", "cohere", "deepseek", "xai"];

// ─── Sub-components for complex editor sections ─────────────────

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

// ─── Allowed/Denied path editor ─────────────────────────────────

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

// ─── Main Settings Page ─────────────────────────────────────────

export function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const updateGeneral = useSettingsStore((s) => s.updateGeneral);
  const updateProviders = useSettingsStore((s) => s.updateProviders);
  const updateOrchestration = useSettingsStore((s) => s.updateOrchestration);
  const updateMemory = useSettingsStore((s) => s.updateMemory);
  const updateExecution = useSettingsStore((s) => s.updateExecution);
  const updateDocker = useSettingsStore((s) => s.updateDocker);
  const updateSecurity = useSettingsStore((s) => s.updateSecurity);
  const updateBrowser = useSettingsStore((s) => s.updateBrowser);
  const updateLogging = useSettingsStore((s) => s.updateLogging);
  const updatePlugins = useSettingsStore((s) => s.updatePlugins);
  const updateDeployment = useSettingsStore((s) => s.updateDeployment);
  const updateEvaluation = useSettingsStore((s) => s.updateEvaluation);
  const updateGUI = useSettingsStore((s) => s.updateGUI);
  const resetAll = useSettingsStore((s) => s.resetAll);
  const isDirty = useSettingsStore((s) => s.isDirty);
  const saveSettings = useSettingsStore((s) => s.saveSettings);

  const [searchQuery, setSearchQuery] = useState("");

  const g = settings.general;
  const p = settings.providers;
  const o = settings.orchestration;
  const m = settings.memory;
  const e = settings.execution;
  const d = settings.docker;
  const sec = settings.security;
  const br = settings.browser;
  const l = settings.logging;
  const pl = settings.plugins;
  const dep = settings.deployment;
  const ev = settings.evaluation;
  const ui = settings.gui;

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
            <SettingsButton
              label="Reset All"
              onClick={resetAll}
              variant="danger"
            />
            <SettingsButton
              label="Save Settings"
              onClick={saveSettings}
              variant="primary"
            />
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
          {/* ═══════════════════════════════════════════════════════
                          1. GENERAL (App / GUI)
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="General" description="Application appearance, startup, and network settings">
            <SettingsRow label="Theme" description="Light, dark, or system theme">
              <SettingsSelect
                value={g.theme}
                options={THEME_OPTIONS}
                onChange={(v) => updateGeneral({ theme: v as "dark" | "light" | "system" })}
              />
            </SettingsRow>
            <SettingsRow label="Language" description="Interface language preference">
              <SettingsSelect
                value={g.language}
                options={LANGUAGE_OPTIONS}
                onChange={(v) => updateGeneral({ language: v })}
              />
            </SettingsRow>
            <SettingsRow label="Startup Behavior" description="Launch behavior on system startup">
              <SettingsSelect
                value={g.startupBehavior}
                options={STARTUP_OPTIONS}
                onChange={(v) => updateGeneral({ startupBehavior: v as "restore" | "minimized" | "hidden" })}
              />
            </SettingsRow>
            <SettingsRow label="Minimize to Tray" description="Minimize to system tray instead of closing">
              <SettingsToggle
                checked={g.minimizeToTray}
                onChange={(v) => updateGeneral({ minimizeToTray: v })}
              />
            </SettingsRow>
            <SettingsRow label="Data Directory" description="Path to store persistent data">
              <SettingsInput
                value={g.dataDir}
                onChange={(v) => updateGeneral({ dataDir: v })}
                placeholder="./data"
                monospace
              />
            </SettingsRow>
            <SettingsRow label="Host" description="Backend server bind address">
              <SettingsInput
                value={g.host}
                onChange={(v) => updateGeneral({ host: v })}
                placeholder="127.0.0.1"
                monospace
              />
            </SettingsRow>
            <SettingsRow label="Port" description="Backend server port">
              <SettingsSlider
                value={g.port}
                min={1024}
                max={65535}
                onChange={(v) => updateGeneral({ port: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          2. GUI / UI SETTINGS
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="User Interface" description="UI display preferences">
            <SettingsRow label="Font Size" description="Base font size in pixels">
              <SettingsSlider
                value={ui.fontSize}
                min={10}
                max={24}
                suffix="px"
                onChange={(v) => updateGUI({ fontSize: v })}
              />
            </SettingsRow>
            <SettingsRow label="Compact Mode" description="Reduce padding and spacing throughout the UI">
              <SettingsToggle
                checked={ui.compactMode}
                onChange={(v) => updateGUI({ compactMode: v })}
              />
            </SettingsRow>
            <SettingsRow label="Show Timestamps" description="Display timestamps on messages and logs">
              <SettingsToggle
                checked={ui.showTimestamps}
                onChange={(v) => updateGUI({ showTimestamps: v })}
              />
            </SettingsRow>
            <SettingsRow label="Show Token Usage" description="Display token counts in agent responses">
              <SettingsToggle
                checked={ui.showTokenUsage}
                onChange={(v) => updateGUI({ showTokenUsage: v })}
              />
            </SettingsRow>
            <SettingsRow label="Refresh Interval" description="Dashboard auto-refresh interval (ms)">
              <SettingsSlider
                value={ui.refreshInterval}
                min={1000}
                max={60000}
                step={1000}
                suffix="ms"
                onChange={(v) => updateGUI({ refreshInterval: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          3. AI PROVIDERS
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="AI Providers" description="Provider configuration, API keys, and routing">
            <SettingsRow label="Default Provider" description="Default AI provider for new agents">
              <SettingsSelect
                value={p.defaultProvider}
                options={PROVIDER_TAGS.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
                onChange={(v) => updateProviders({ defaultProvider: v })}
              />
            </SettingsRow>
            <SettingsRow label="Provider Priorities" description="Order providers by priority (highest first)">
              <SettingsTagGroup
                tags={PROVIDER_TAGS}
                selected={Object.entries(p.providerPriorities)
                  .sort(([, a], [, b]) => a - b)
                  .map(([k]) => k)}
                onChange={(selected) => {
                  const priorities: Record<string, number> = {};
                  selected.forEach((tag, i) => { priorities[tag] = i + 1; });
                  updateProviders({ providerPriorities: priorities });
                }}
              />
            </SettingsRow>
            <SettingsRow label="Fallback Chains" description="Ordered fallback providers when primary fails">
              <SettingsTagGroup
                tags={PROVIDER_TAGS}
                selected={p.fallbackChains}
                onChange={(selected) => updateProviders({ fallbackChains: selected })}
              />
            </SettingsRow>
            <SettingsRow label="API Keys" description="Manage API keys for each provider" beta>
              <ApiKeysEditor />
            </SettingsRow>
            <SettingsRow label="Custom Headers" description="Additional HTTP headers for provider requests" beta>
              <CustomHeadersEditor />
            </SettingsRow>
            <SettingsRow label="Rate Limit — RPM" description="Max requests per minute">
              <SettingsSlider
                value={p.rateLimits.requestsPerMinute}
                min={1}
                max={1000}
                step={10}
                suffix=" rpm"
                onChange={(v) => updateProviders({ rateLimits: { ...p.rateLimits, requestsPerMinute: v } })}
              />
            </SettingsRow>
            <SettingsRow label="Rate Limit — TPM" description="Max tokens per minute">
              <SettingsSlider
                value={p.rateLimits.tokensPerMinute}
                min={1000}
                max={10000000}
                step={10000}
                suffix=" tpm"
                onChange={(v) => updateProviders({ rateLimits: { ...p.rateLimits, tokensPerMinute: v } })}
              />
            </SettingsRow>
            <SettingsRow label="Concurrent Requests" description="Max concurrent requests per provider">
              <SettingsSlider
                value={p.rateLimits.concurrentRequests}
                min={1}
                max={50}
                suffix=" req"
                onChange={(v) => updateProviders({ rateLimits: { ...p.rateLimits, concurrentRequests: v } })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          4. ORCHESTRATION
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Orchestration" description="Workflow graph execution and loop controls">
            <SettingsRow label="Max Turn Loop" description="Hard limit on agent turns before forced stop">
              <SettingsSlider
                value={o.maxTurnLoop}
                min={10}
                max={1000}
                step={10}
                suffix=" turns"
                onChange={(v) => updateOrchestration({ maxTurnLoop: v })}
              />
            </SettingsRow>
            <SettingsRow label="Default Max Turns" description="Default per-agent max turns">
              <SettingsSlider
                value={o.defaultMaxTurns}
                min={5}
                max={200}
                step={5}
                suffix=" turns"
                onChange={(v) => updateOrchestration({ defaultMaxTurns: v })}
              />
            </SettingsRow>
            <SettingsRow label="Autonomous Loop Limit" description="Max autonomous iterations before human check">
              <SettingsSlider
                value={o.autonomousLoopLimit}
                min={1}
                max={200}
                step={5}
                suffix=" loops"
                onChange={(v) => updateOrchestration({ autonomousLoopLimit: v })}
              />
            </SettingsRow>
            <SettingsRow label="Graph Checkpointing" description="Save workflow graph state at intervals">
              <SettingsToggle
                checked={o.graphCheckpointEnabled}
                onChange={(v) => updateOrchestration({ graphCheckpointEnabled: v })}
              />
            </SettingsRow>
            {o.graphCheckpointEnabled && (
              <SettingsRow label="Checkpoint Interval" description="Seconds between graph state checkpoints">
                <SettingsSlider
                  value={o.checkpointInterval}
                  min={5}
                  max={300}
                  step={5}
                  suffix="s"
                  onChange={(v) => updateOrchestration({ checkpointInterval: v })}
                />
              </SettingsRow>
            )}
            <SettingsRow label="Max Parallel Nodes" description="Max nodes executed simultaneously in a graph">
              <SettingsSlider
                value={o.maxParallelNodes}
                min={1}
                max={32}
                suffix=" nodes"
                onChange={(v) => updateOrchestration({ maxParallelNodes: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          5. RETRY POLICIES
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Retry Policies" description="Backoff and retry settings for failed operations">
            <SettingsRow label="Max Retry Attempts" description="Max retries before marking a step as failed">
              <SettingsSlider
                value={o.retryPolicy.maxAttempts}
                min={0}
                max={20}
                suffix="x"
                onChange={(v) =>
                  updateOrchestration({ retryPolicy: { ...o.retryPolicy, maxAttempts: v } })
                }
              />
            </SettingsRow>
            <SettingsRow label="Backoff Strategy" description="How delay increases between retries">
              <SettingsSelect
                value={o.retryPolicy.backoff}
                options={BACKOFF_OPTIONS}
                onChange={(v) =>
                  updateOrchestration({ retryPolicy: { ...o.retryPolicy, backoff: v as BackoffType } })
                }
              />
            </SettingsRow>
            <SettingsRow label="Initial Delay" description="Initial delay before first retry (ms)">
              <SettingsSlider
                value={o.retryPolicy.initialDelay}
                min={100}
                max={30000}
                step={100}
                suffix="ms"
                onChange={(v) =>
                  updateOrchestration({ retryPolicy: { ...o.retryPolicy, initialDelay: v } })
                }
              />
            </SettingsRow>
            <SettingsRow label="Max Delay" description="Maximum delay between retries (ms)">
              <SettingsSlider
                value={o.retryPolicy.maxDelay}
                min={1000}
                max={300000}
                step={1000}
                suffix="ms"
                onChange={(v) =>
                  updateOrchestration({ retryPolicy: { ...o.retryPolicy, maxDelay: v } })
                }
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          6. MEMORY & EMBEDDINGS
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Memory & Embeddings" description="Storage backend, vector DB, chunking, and retrieval">
            <SettingsRow label="Memory System" description="Enable persistent memory for agents">
              <SettingsToggle
                checked={m.memoryEnabled}
                onChange={(v) => updateMemory({ memoryEnabled: v })}
              />
            </SettingsRow>
            {m.memoryEnabled && (
              <>
                <SettingsRow label="Storage Backend" description="Database engine for memory storage">
                  <SettingsSelect
                    value={m.storageType}
                    options={STORAGE_OPTIONS}
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
                <SettingsRow label="Collection Name" description="Vector collection / table name">
                  <SettingsInput
                    value={m.collectionName}
                    onChange={(v) => updateMemory({ collectionName: v })}
                    placeholder="aether_memories"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Embedding Provider" description="Provider for text embeddings">
                  <SettingsInput
                    value={m.embeddingProvider}
                    onChange={(v) => updateMemory({ embeddingProvider: v })}
                    placeholder="openai"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Embedding Model" description="Model name for embeddings">
                  <SettingsInput
                    value={m.embeddingModel}
                    onChange={(v) => updateMemory({ embeddingModel: v })}
                    placeholder="text-embedding-ada-002"
                    monospace
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
                <SettingsRow label="Embedding Batch Size" description="Batch size for embedding API calls">
                  <SettingsSlider
                    value={m.embeddingBatchSize}
                    min={1}
                    max={200}
                    step={5}
                    suffix=" docs"
                    onChange={(v) => updateMemory({ embeddingBatchSize: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Chunking Strategy" description="How to split documents for embedding">
                  <SettingsSelect
                    value={m.chunkingStrategy}
                    options={CHUNK_OPTIONS}
                    onChange={(v) => updateMemory({ chunkingStrategy: v as ChunkingStrategy })}
                  />
                </SettingsRow>
                <SettingsRow label="Max Chunk Size" description="Maximum tokens per chunk">
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
                <SettingsRow label="Top-K Results" description="Number of results to retrieve per query">
                  <SettingsSlider
                    value={m.topK}
                    min={1}
                    max={100}
                    suffix=" docs"
                    onChange={(v) => updateMemory({ topK: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Min Score Threshold" description="Minimum similarity score for results">
                  <SettingsSlider
                    value={m.minScore}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    onChange={(v) => updateMemory({ minScore: v / 100 })}
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

          {/* ═══════════════════════════════════════════════════════
                          7. EXECUTION
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Execution" description="Agent execution limits, timeouts, and resource budgets">
            <SettingsRow label="Max Concurrent Agents" description="Number of agents running simultaneously">
              <SettingsSlider
                value={e.maxConcurrent}
                min={1}
                max={64}
                suffix=" agents"
                onChange={(v) => updateExecution({ maxConcurrent: v })}
              />
            </SettingsRow>
            <SettingsRow label="Default Timeout" description="Default per-agent timeout (seconds)">
              <SettingsSlider
                value={e.defaultTimeout}
                min={30}
                max={3600}
                step={30}
                suffix="s"
                onChange={(v) => updateExecution({ defaultTimeout: v })}
              />
            </SettingsRow>
            <SettingsRow label="Max Retries" description="Max per-step retries before failure">
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
            <SettingsRow label="Max Memory" description="Max memory per agent (MB)">
              <SettingsSlider
                value={e.resourceLimits.maxMemoryMB}
                min={64}
                max={32768}
                step={64}
                suffix=" MB"
                onChange={(v) => updateExecution({ resourceLimits: { ...e.resourceLimits, maxMemoryMB: v } })}
              />
            </SettingsRow>
            <SettingsRow label="Max CPU" description="Max CPU percent per agent">
              <SettingsSlider
                value={e.resourceLimits.maxCPUPercent}
                min={10}
                max={100}
                step={10}
                suffix="%"
                onChange={(v) => updateExecution({ resourceLimits: { ...e.resourceLimits, maxCPUPercent: v } })}
              />
            </SettingsRow>
            <SettingsRow label="Max Disk" description="Max disk usage per agent (MB)">
              <SettingsSlider
                value={e.resourceLimits.maxDiskMB}
                min={50}
                max={32768}
                step={50}
                suffix=" MB"
                onChange={(v) => updateExecution({ resourceLimits: { ...e.resourceLimits, maxDiskMB: v } })}
              />
            </SettingsRow>
            <SettingsRow label="Token Budget" description="Token budget per agent turn">
              <SettingsSlider
                value={e.tokenBudgetPerTurn}
                min={1024}
                max={128000}
                step={1024}
                suffix=" tokens"
                onChange={(v) => updateExecution({ tokenBudgetPerTurn: v })}
              />
            </SettingsRow>
            <SettingsRow label="Context Window" description="Max context window tokens per agent">
              <SettingsSlider
                value={e.contextWindowLimit}
                min={4096}
                max={1000000}
                step={4096}
                suffix=" tokens"
                onChange={(v) => updateExecution({ contextWindowLimit: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          8. DOCKER / SANDBOX
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Docker & Sandbox" description="Container execution, sandboxing, and isolation">
            <SettingsRow label="Sandbox Execution" description="Run agent steps inside Docker containers">
              <SettingsToggle
                checked={d.sandboxEnabled}
                onChange={(v) => updateDocker({ sandboxEnabled: v })}
              />
            </SettingsRow>
            {d.sandboxEnabled && (
              <>
                <SettingsRow label="Docker Socket" description="Path to the Docker socket">
                  <SettingsInput
                    value={d.dockerSocketPath}
                    onChange={(v) => updateDocker({ dockerSocketPath: v })}
                    placeholder="/var/run/docker.sock"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Default Image" description="Default sandbox Docker image">
                  <SettingsInput
                    value={d.defaultImage}
                    onChange={(v) => updateDocker({ defaultImage: v })}
                    placeholder="aether-sandbox:latest"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Network Mode" description="Container network mode">
                  <SettingsSelect
                    value={d.networkMode}
                    options={NETWORK_OPTIONS}
                    onChange={(v) => updateDocker({ networkMode: v as NetworkMode })}
                  />
                </SettingsRow>
                <SettingsRow label="Container Memory Limit" description="Max memory per container (MB)">
                  <SettingsSlider
                    value={d.memoryLimit}
                    min={64}
                    max={16384}
                    step={64}
                    suffix=" MB"
                    onChange={(v) => updateDocker({ memoryLimit: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Container CPU Limit" description="Max CPU cores per container">
                  <SettingsSlider
                    value={d.cpuLimit}
                    min={1}
                    max={32}
                    suffix=" cores"
                    onChange={(v) => updateDocker({ cpuLimit: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Sandbox Timeout" description="Max runtime per sandbox session (seconds)">
                  <SettingsSlider
                    value={d.timeout}
                    min={30}
                    max={3600}
                    step={30}
                    suffix="s"
                    onChange={(v) => updateDocker({ timeout: v })}
                  />
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          9. BROWSER AUTOMATION
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Browser Automation" description="Headless browser and web scraping configuration">
            <SettingsRow label="Browser Automation" description="Enable browser automation for agents">
              <SettingsToggle
                checked={br.browserAutomationEnabled}
                onChange={(v) => updateBrowser({ browserAutomationEnabled: v })}
              />
            </SettingsRow>
            {br.browserAutomationEnabled && (
              <>
                <SettingsRow label="Headless Mode" description="Run browser without visible window">
                  <SettingsToggle
                    checked={br.headlessMode}
                    onChange={(v) => updateBrowser({ headlessMode: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Viewport Width" description="Default browser viewport width (px)">
                  <SettingsSlider
                    value={br.defaultViewport.width}
                    min={640}
                    max={3840}
                    step={160}
                    suffix="px"
                    onChange={(v) => updateBrowser({ defaultViewport: { ...br.defaultViewport, width: v } })}
                  />
                </SettingsRow>
                <SettingsRow label="Viewport Height" description="Default browser viewport height (px)">
                  <SettingsSlider
                    value={br.defaultViewport.height}
                    min={480}
                    max={2160}
                    step={60}
                    suffix="px"
                    onChange={(v) => updateBrowser({ defaultViewport: { ...br.defaultViewport, height: v } })}
                  />
                </SettingsRow>
                <SettingsRow label="Navigation Timeout" description="Max page load timeout (ms)">
                  <SettingsSlider
                    value={br.timeout}
                    min={1000}
                    max={120000}
                    step={1000}
                    suffix="ms"
                    onChange={(v) => updateBrowser({ timeout: v })}
                  />
                </SettingsRow>
                <SettingsRow label="Screenshots" description="Capture screenshots during automation">
                  <SettingsToggle
                    checked={br.screenshotEnabled}
                    onChange={(v) => updateBrowser({ screenshotEnabled: v })}
                  />
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          10. LOGGING, TRACING & TELEMETRY
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Logging, Tracing & Telemetry" description="Observability, metrics, and diagnostics">
            <SettingsRow label="Log Level" description="Verbosity of application logs">
              <SettingsSelect
                value={l.logLevel}
                options={LOG_LEVEL_OPTIONS}
                onChange={(v) => updateLogging({ logLevel: v as "debug" | "info" | "warn" | "error" })}
              />
            </SettingsRow>
            <SettingsRow label="Logging Verbosity" description="Numeric verbosity level for detailed logging">
              <SettingsSlider
                value={l.loggingVerbosity}
                min={0}
                max={10}
                suffix=""
                onChange={(v) => updateLogging({ loggingVerbosity: v })}
              />
            </SettingsRow>
            <SettingsRow label="Log Retention" description="Days to retain log files">
              <SettingsSlider
                value={l.logRetentionDays}
                min={1}
                max={365}
                step={7}
                suffix=" days"
                onChange={(v) => updateLogging({ logRetentionDays: v })}
              />
            </SettingsRow>
            <SettingsRow label="Distributed Tracing" description="Enable OpenTelemetry distributed tracing">
              <SettingsToggle
                checked={l.tracingEnabled}
                onChange={(v) => updateLogging({ tracingEnabled: v })}
              />
            </SettingsRow>
            <SettingsRow label="Telemetry" description="Send anonymized usage telemetry">
              <SettingsToggle
                checked={l.telemetryEnabled}
                onChange={(v) => updateLogging({ telemetryEnabled: v })}
              />
            </SettingsRow>
            <SettingsRow label="Metrics Collection" description="Enable Prometheus-style metrics">
              <SettingsToggle
                checked={l.metricsEnabled}
                onChange={(v) => updateLogging({ metricsEnabled: v })}
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          11. PLUGINS
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Plugins" description="Plugin directory, auto-load, and management">
            <SettingsRow label="Plugin Directory" description="Path to scan for installed plugins">
              <SettingsInput
                value={pl.pluginDir}
                onChange={(v) => updatePlugins({ pluginDir: v })}
                placeholder="./plugins"
                monospace
              />
            </SettingsRow>
            <SettingsRow label="Auto-Load Plugins" description="Load enabled plugins on startup">
              <SettingsToggle
                checked={pl.autoLoadPlugins}
                onChange={(v) => updatePlugins({ autoLoadPlugins: v })}
              />
            </SettingsRow>
            <SettingsRow label="Enabled Plugins" description="Plugins enabled for use in agents">
              <SettingsInput
                value={pl.enabledPlugins.join(", ")}
                onChange={(v) =>
                  updatePlugins({ enabledPlugins: v.split(",").map((s) => s.trim()).filter(Boolean) })
                }
                placeholder="plugin-a, plugin-b, plugin-c"
                width="min-w-[240px]"
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          12. EVALUATION
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Evaluation" description="Agent evaluation metrics, datasets, and frequency">
            <SettingsRow label="Evaluations" description="Enable agent evaluation framework">
              <SettingsToggle
                checked={ev.evalEnabled}
                onChange={(v) => updateEvaluation({ evalEnabled: v })}
              />
            </SettingsRow>
            {ev.evalEnabled && (
              <>
                <SettingsRow label="Metric" description="Primary evaluation metric">
                  <SettingsSelect
                    value={ev.evalMetric}
                    options={EVAL_METRIC_OPTIONS}
                    onChange={(v) => updateEvaluation({ evalMetric: v as "accuracy" | "bleu" | "rouge" | "custom" })}
                  />
                </SettingsRow>
                <SettingsRow label="Dataset" description="Path or ID of evaluation dataset">
                  <SettingsInput
                    value={ev.evalDataset}
                    onChange={(v) => updateEvaluation({ evalDataset: v })}
                    placeholder="eval-dataset"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Frequency" description="How often evaluations run">
                  <SettingsSelect
                    value={ev.evalFrequency}
                    options={EVAL_FREQUENCY_OPTIONS}
                    onChange={(v) => updateEvaluation({ evalFrequency: v as EvalFrequency })}
                  />
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          13. SECURITY & RBAC
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Security & RBAC" description="Access control, command policies, MCP servers">
            <SettingsRow label="RBAC" description="Role-based access control for multi-user setups" beta>
              <SettingsToggle
                checked={sec.rbacEnabled}
                onChange={(v) => updateSecurity({ rbacEnabled: v })}
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

          {/* ═══════════════════════════════════════════════════════
                          14. DEPLOYMENT & CI/CD
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Deployment & CI/CD" description="Commit settings, deployment targets, and CI pipeline">
            <SettingsRow label="CI/CD Pipeline" description="Enable automated CI/CD for agent builds" beta>
              <SettingsToggle
                checked={dep.cicdEnabled}
                onChange={(v) => updateDeployment({ cicdEnabled: v })}
              />
            </SettingsRow>
            <SettingsRow label="Auto-Commit" description="Automatically commit agent code changes">
              <SettingsToggle
                checked={dep.commitSettings.autoCommit}
                onChange={(v) =>
                  updateDeployment({ commitSettings: { ...dep.commitSettings, autoCommit: v } })
                }
              />
            </SettingsRow>
            {dep.commitSettings.autoCommit && (
              <>
                <SettingsRow label="Commit Prefix" description="Prefix for auto-generated commit messages">
                  <SettingsInput
                    value={dep.commitSettings.commitMessagePrefix}
                    onChange={(v) =>
                      updateDeployment({ commitSettings: { ...dep.commitSettings, commitMessagePrefix: v } })
                    }
                    placeholder="aether:"
                    monospace
                  />
                </SettingsRow>
                <SettingsRow label="Signed Commits" description="Sign commits with GPG">
                  <SettingsToggle
                    checked={dep.commitSettings.signCommits}
                    onChange={(v) =>
                      updateDeployment({ commitSettings: { ...dep.commitSettings, signCommits: v } })
                    }
                  />
                </SettingsRow>
              </>
            )}
            <SettingsRow label="Deployment Target" description="Target environment for deployment">
              <SettingsSelect
                value={dep.deploymentTarget}
                options={DEPLOY_TARGET_OPTIONS}
                onChange={(v) => updateDeployment({ deploymentTarget: v as DeploymentTarget })}
              />
            </SettingsRow>
            <SettingsRow label="Deployment URL" description="URL for remote deployment target">
              <SettingsInput
                value={dep.deploymentUrl}
                onChange={(v) => updateDeployment({ deploymentUrl: v })}
                placeholder="https://deploy.aether.local"
                monospace
              />
            </SettingsRow>
          </SettingsSection>

          {/* ═══════════════════════════════════════════════════════
                          15. LOCAL & CLOUD MODEL SETTINGS
                         ═══════════════════════════════════════════════ */}
          <SettingsSection title="Model Settings" description="Local inference and cloud model configuration">
            <SettingsRow
              label="Local Models"
              description="Configure local model endpoints (Ollama, llama.cpp, vLLM)"
            >
              <SettingsInput
                value={p.customHeaders["local_endpoint"] || ""}
                onChange={(v) => {
                  const hdrs = { ...p.customHeaders };
                  if (v) hdrs["local_endpoint"] = v;
                  else delete hdrs["local_endpoint"];
                  updateProviders({ customHeaders: hdrs });
                }}
                placeholder="http://localhost:11434"
                monospace
              />
            </SettingsRow>
            <SettingsRow
              label="Cloud Models"
              description="Configure cloud model API endpoints"
            >
              <SettingsInput
                value={p.customHeaders["cloud_endpoint"] || ""}
                onChange={(v) => {
                  const hdrs = { ...p.customHeaders };
                  if (v) hdrs["cloud_endpoint"] = v;
                  else delete hdrs["cloud_endpoint"];
                  updateProviders({ customHeaders: hdrs });
                }}
                placeholder="https://api.openai.com"
                monospace
              />
            </SettingsRow>
          </SettingsSection>

          {/* ── Bottom padding ── */}
          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
