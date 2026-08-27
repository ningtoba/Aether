import React, { useState, useMemo } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { SettingsToggle, SettingsInput } from "../components/SettingsComponents";

// ─── Types ──────────────────────────────────────────────────────────

type PluginType = "tool" | "provider" | "workflow" | "ui";

interface PluginConfigOption {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  default: string | number | boolean;
  options?: string[];
  description?: string;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: PluginType;
  permissions: string[];
  configOptions: PluginConfigOption[];
  homepage?: string;
  repository?: string;
  license?: string;
}

interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  config: Record<string, string | number | boolean>;
}

// ─── Mock Data ──────────────────────────────────────────────────────

const MOCK_INSTALLED: InstalledPlugin[] = [
  {
    enabled: true,
    config: { model: "gpt-4o", temperature: 0.7, maxTokens: 4096 },
    manifest: {
      id: "aether-provider-openai",
      name: "OpenAI Provider",
      version: "1.3.0",
      description: "OpenAI API integration with support for GPT-4, GPT-4o, GPT-3.5 and DALL-E models.",
      author: "Aether Team",
      type: "provider",
      permissions: ["network:api.openai.com", "store:api-keys"],
      configOptions: [
        { key: "model", label: "Default Model", type: "select", default: "gpt-4o", options: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-4"], description: "Primary model to use for requests" },
        { key: "temperature", label: "Temperature", type: "number", default: 0.7, description: "Response randomness (0.0 - 2.0)" },
        { key: "maxTokens", label: "Max Tokens", type: "number", default: 4096, description: "Maximum tokens per response" },
      ],
    },
  },
  {
    enabled: true,
    config: { memoryLimit: 500, strategy: "recent" },
    manifest: {
      id: "aether-memory-sqlite",
      name: "SQLite Memory Backend",
      version: "0.9.2",
      description: "Persistent memory storage using SQLite for conversation history and embeddings.",
      author: "Aether Team",
      type: "tool",
      permissions: ["filesystem:read", "filesystem:write"],
      configOptions: [
        { key: "memoryLimit", label: "Memory Limit (MB)", type: "number", default: 500, description: "Max storage for memory entries" },
        { key: "strategy", label: "Retrieval Strategy", type: "select", default: "recent", options: ["recent", "semantic", "hybrid"], description: "How to retrieve relevant memories" },
      ],
    },
  },
  {
    enabled: false,
    config: { port: 8080, logLevel: "info" },
    manifest: {
      id: "aether-server-http",
      name: "HTTP API Server",
      version: "2.1.0",
      description: "Exposes a RESTful HTTP API for external tools and integrations.",
      author: "Community",
      type: "ui",
      permissions: ["network:bind", "network:serve"],
      configOptions: [
        { key: "port", label: "Listen Port", type: "number", default: 8080, description: "HTTP server port" },
        { key: "logLevel", label: "Log Level", type: "select", default: "info", options: ["debug", "info", "warn", "error"], description: "Verbosity of server logs" },
      ],
    },
  },
  {
    enabled: true,
    config: { targetDir: "./output", format: "markdown", autoSync: false },
    manifest: {
      id: "aether-exporter",
      name: "Conversation Exporter",
      version: "1.0.1",
      description: "Export agent conversations to markdown, JSON, or HTML formats.",
      author: "Aether Team",
      type: "tool",
      permissions: ["filesystem:write"],
      configOptions: [
        { key: "targetDir", label: "Export Directory", type: "string", default: "./output", description: "Where exported files are saved" },
        { key: "format", label: "Export Format", type: "select", default: "markdown", options: ["markdown", "json", "html"], description: "File format for exports" },
        { key: "autoSync", label: "Auto-Sync", type: "boolean", default: false, description: "Automatically export after each conversation" },
      ],
    },
  },
];

const MOCK_MARKETPLACE: PluginManifest[] = [
  {
    id: "aether-code-analyzer",
    name: "Code Analyzer",
    version: "0.4.0",
    description: "Static analysis and linting for Python, TypeScript, and Rust files. Provides inline suggestions.",
    author: "Aether Labs",
    type: "tool",
    permissions: ["filesystem:read", "process:exec"],
    configOptions: [
      { key: "languages", label: "Languages", type: "string", default: "python,typescript,rust", description: "Comma-separated language list" },
    ],
  },
  {
    id: "aether-slack-connector",
    name: "Slack Connector",
    version: "祭 0.6.0",
    description: "Connect Aether agents to Slack workspaces. Send messages, read channels, and react to events.",
    author: "Community",
    type: "provider",
    permissions: ["network:api.slack.com", "store:oauth-tokens"],
    configOptions: [
      { key: "workspace", label: "Workspace ID", type: "string", default: "", description: "Slack workspace identifier" },
    ],
  },
  {
    id: "aether-web-scraper",
    name: "Web Scraper",
    version: "1.2.0",
    description: "Scrape and extract structured data from web pages using CSS selectors and AI parsing.",
    author: "Aether Team",
    type: "tool",
    permissions: ["network:fetch", "filesystem:write"],
    configOptions: [
      { key: "userAgent", label: "User Agent", type: "string", default: "AetherBot/1.0", description: "HTTP User-Agent header" },
      { key: "rateLimit", label: "Rate Limit (req/min)", type: "number", default: 30, description: "Max requests per minute" },
    ],
  },
  {
    id: "aether-vision-processor",
    name: "Vision Processor",
    version: "0.8.0",
    description: "Image analysis and OCR using vision-language models. Extract text, describe scenes, detect objects.",
    author: "Aether Labs",
    type: "tool",
    permissions: ["filesystem:read", "network:image-hosting"],
    configOptions: [
      { key: "maxImageSize", label: "Max Image Size (MB)", type: "number", default: 10, description: "Maximum image file size" },
      { key: "ocrEnabled", label: "OCR Enabled", type: "boolean", default: true, description: "Enable text extraction from images" },
    ],
  },
  {
    id: "aether-github-actions",
    name: "GitHub Actions Runner",
    version: "0.3.0",
    description: "Trigger and monitor GitHub Actions workflows directly from Aether agents.",
    author: "Community",
    type: "workflow",
    permissions: ["network:api.github.com", "store:oauth-tokens"],
    configOptions: [
      { key: "token", label: "GitHub Token", type: "string", default: "", description: "Personal access token" },
    ],
  },
  {
    id: "aether-chart-renderer",
    name: "Chart Renderer",
    version: "1.0.0",
    description: "Render data as interactive charts (bar, line, pie, scatter) using ECharts. Embeddable in agent responses.",
    author: "Aether Team",
    type: "ui",
    permissions: ["ui:embed"],
    configOptions: [
      { key: "theme", label: "Chart Theme", type: "select", default: "dark", options: ["dark", "light", "auto"], description: "Visual theme for charts" },
      { key: "defaultWidth", label: "Default Width (px)", type: "number", default: 600, description: "Default chart width" },
    ],
  },
];

const TYPE_COLORS: Record<PluginType, string> = {
  tool: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  provider: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  workflow: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  ui: "text-purple-400 bg-purple-400/10 border-purple-400/20",
};

const PERMISSION_LABELS: Record<string, string> = {
  "network:api.openai.com": "OpenAI API",
  "network:api.github.com": "GitHub API",
  "network:api.slack.com": "Slack API",
  "network:bind": "Bind network ports",
  "network:serve": "Serve HTTP",
  "network:fetch": "HTTP requests",
  "network:image-hosting": "Image hosting",
  "store:api-keys": "API key storage",
  "store:oauth-tokens": "OAuth token storage",
  "filesystem:read": "Read files",
  "filesystem:write": "Write files",
  "process:exec": "Execute processes",
  "ui:embed": "Embed UI elements",
};

function permissionLabel(p: string): string {
  return PERMISSION_LABELS[p] || p;
}

// ─── Sub-Components ─────────────────────────────────────────────────

function PluginTypeBadge({ type }: { type: PluginType }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${TYPE_COLORS[type]}`}
    >
      {type}
    </span>
  );
}

function PluginDetails({
  manifest,
  config,
  onConfigChange,
}: {
  manifest: PluginManifest;
  config: Record<string, string | number | boolean>;
  onConfigChange: (key: string, value: string | number | boolean) => void;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-[#1e1e24] space-y-2.5">
      {/* Author & license */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-gray-500">
          Author: <span className="text-gray-300">{manifest.author}</span>
        </span>
        {manifest.license && (
          <span className="text-gray-500">
            License: <span className="text-gray-300">{manifest.license}</span>
          </span>
        )}
        <span className="text-gray-500">
          Version: <span className="text-gray-300">{manifest.version}</span>
        </span>
      </div>

      {/* Links */}
      {(manifest.homepage || manifest.repository) && (
        <div className="flex items-center gap-3 text-[11px]">
          {manifest.homepage && (
            <a href={manifest.homepage} className="text-[#a78bfa] hover:underline" target="_blank" rel="noopener noreferrer">
              Homepage
            </a>
          )}
          {manifest.repository && (
            <a href={manifest.repository} className="text-[#a78bfa] hover:underline" target="_blank" rel="noopener noreferrer">
              Repository
            </a>
          )}
        </div>
      )}

      {/* Permissions */}
      <div>
        <p className="text-[11px] font-medium text-gray-400 mb-1.5">
          Permissions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {manifest.permissions.map((perm) => (
            <span
              key={perm}
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-[#1e1e24] border border-[#2a2a33] text-gray-400"
            >
              {permissionLabel(perm)}
            </span>
          ))}
        </div>
      </div>

      {/* Config options rendered as form fields */}
      {manifest.configOptions.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-gray-400 mb-2">
            Configuration
          </p>
          <div className="space-y-2">
            {manifest.configOptions.map((opt) => {
              const currentVal =
                config[opt.key] !== undefined ? config[opt.key] : opt.default;

              const handleChange = (val: string | number | boolean) => {
                onConfigChange(opt.key, val);
              };

              return (
                <div key={opt.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="text-xs text-gray-300 block leading-tight">
                      {opt.label}
                    </label>
                    {opt.description && (
                      <p className="text-[10px] text-gray-500 mt-0.5">{opt.description}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {opt.type === "boolean" ? (
                      <SettingsToggle
                        checked={Boolean(currentVal)}
                        onChange={(v) => handleChange(v)}
                      />
                    ) : opt.type === "select" && opt.options ? (
                      <select
                        value={String(currentVal)}
                        onChange={(e) => handleChange(e.target.value)}
                        className="text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg px-2.5 py-1 outline-none focus:border-[#a78bfa]/50 min-w-[120px]"
                      >
                        {opt.options.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : opt.type === "number" ? (
                      <input
                        type="number"
                        value={Number(currentVal)}
                        onChange={(e) => handleChange(Number(e.target.value))}
                        className="text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg px-2.5 py-1 outline-none focus:border-[#a78bfa]/50 w-20 font-mono text-right"
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(currentVal)}
                        onChange={(e) => handleChange(e.target.value)}
                        className="text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg px-2.5 py-1 outline-none focus:border-[#a78bfa]/50 w-36 font-mono"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function InstalledPluginCard({
  plugin,
  onToggle,
  onConfigChange,
}: {
  plugin: InstalledPlugin;
  onToggle: (id: string, enabled: boolean) => void;
  onConfigChange: (id: string, key: string, value: string | number | boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const m = plugin.manifest;

  return (
    <div
      className={`bg-[#14141a] border rounded-xl transition-all ${
        plugin.enabled ? "border-[#1e1e24] hover:border-[#2a2a33]" : "border-[#1a1a20] opacity-60 hover:opacity-80"
      }`}
    >
      {/* Card header */}
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Toggle */}
        <SettingsToggle
          checked={plugin.enabled}
          onChange={(v) => onToggle(m.id, v)}
        />
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`text-sm font-semibold ${plugin.enabled ? "text-gray-100" : "text-gray-400"}`}>
              {m.name}
            </h3>
            <PluginTypeBadge type={m.type} />
            <span className="text-[10px] text-gray-500 font-mono">v{m.version}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5 truncate">{m.description}</p>
        </div>
        {/* Expand */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M4 5.5L7 8.5L10 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4">
          <PluginDetails
            manifest={m}
            config={plugin.config}
            onConfigChange={(key, val) => onConfigChange(m.id, key, val)}
          />
        </div>
      )}
    </div>
  );
}

function MarketplaceCard({
  plugin,
  installed,
  onInstall,
}: {
  plugin: PluginManifest;
  installed: boolean;
  onInstall: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl hover:border-[#2a2a33] transition-colors">
      <div className="px-4 py-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-100">{plugin.name}</h3>
              <PluginTypeBadge type={plugin.type} />
              <span className="text-[10px] text-gray-500 font-mono">v{plugin.version}</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{plugin.description}</p>
          </div>
          <div className="flex-shrink-0">
            <button
              onClick={() => onInstall(plugin.id)}
              disabled={installed}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                installed
                  ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 cursor-default"
                  : "bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/20 hover:bg-[#a78bfa]/20"
              }`}
            >
              {installed ? "Installed" : "Install"}
            </button>
          </div>
        </div>

        {/* Author */}
        <div className="text-[10px] text-gray-500">
          by <span className="text-gray-400">{plugin.author}</span>
        </div>

        {/* Permissions preview */}
        <div className="flex flex-wrap gap-1 mt-2">
          {plugin.permissions.map((perm) => (
            <span
              key={perm}
              className="text-[9px] px-1.5 py-0.5 rounded bg-[#1e1e24] border border-[#2a2a33] text-gray-500"
            >
              {permissionLabel(perm)}
            </span>
          ))}
        </div>

        {/* Expand details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors mt-2"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M3 3.5L5 6.5L7 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {expanded ? "Less info" : "More info"}
        </button>

        {expanded && (
          <div className="mt-2 pt-2 border-t border-[#1e1e24] text-[11px] text-gray-400 space-y-1">
            {plugin.configOptions.map((opt) => (
              <div key={opt.key}>
                <span className="text-gray-500">{opt.label}:</span>{" "}
                <span className="text-gray-300 font-mono">{String(opt.default)}</span>
                {opt.description && (
                  <span className="text-gray-500 ml-1">({opt.description})</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Plugin Page ───────────────────────────────────────────────

type Tab = "installed" | "discover" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "installed", label: "Installed" },
  { id: "discover", label: "Discover" },
  { id: "settings", label: "Settings" },
];

export function PluginPage() {
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [searchQuery, setSearchQuery] = useState("");
  const [installed, setInstalled] = useState<InstalledPlugin[]>(MOCK_INSTALLED);
  const [marketplaceInstalled, setMarketplaceInstalled] = useState<Set<string>>(
    new Set(MOCK_INSTALLED.map((p) => p.manifest.id))
  );

  const settings = useSettingsStore((s) => s.settings);
  const updatePlugins = useSettingsStore((s) => s.updatePlugins);

  // ── Handlers ──

  const handleToggle = (id: string, enabled: boolean) => {
    setInstalled((prev) =>
      prev.map((p) => (p.manifest.id === id ? { ...p, enabled } : p))
    );
  };

  const handleConfigChange = (
    id: string,
    key: string,
    value: string | number | boolean,
  ) => {
    setInstalled((prev) =>
      prev.map((p) =>
        p.manifest.id === id
          ? { ...p, config: { ...p.config, [key]: value } }
          : p,
      ),
    );
  };

  const handleInstall = (id: string) => {
    const manifest = MOCK_MARKETPLACE.find((m) => m.id === id);
    if (!manifest) return;

    const defaultConfig: Record<string, string | number | boolean> = {};
    for (const opt of manifest.configOptions) {
      defaultConfig[opt.key] = opt.default;
    }

    setInstalled((prev) => [
      ...prev,
      { manifest, enabled: true, config: defaultConfig },
    ]);
    setMarketplaceInstalled((prev) => new Set(prev).add(id));
  };

  const handleRemove = (id: string) => {
    setInstalled((prev) => prev.filter((p) => p.manifest.id !== id));
    setMarketplaceInstalled((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // ── Derived state ──

  const filteredInstalled = useMemo(() => {
    if (!searchQuery.trim()) return installed;
    const q = searchQuery.toLowerCase();
    return installed.filter(
      (p) =>
        p.manifest.name.toLowerCase().includes(q) ||
        p.manifest.description.toLowerCase().includes(q) ||
        p.manifest.author.toLowerCase().includes(q),
    );
  }, [installed, searchQuery]);

  const filteredMarketplace = useMemo(() => {
    if (!searchQuery.trim()) return MOCK_MARKETPLACE;
    const q = searchQuery.toLowerCase();
    return MOCK_MARKETPLACE.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const pl = settings.plugins;

  // ── Render ──

  return (
    <div className="plugin-page h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-8 pt-8 pb-4 border-b border-[#1e1e24]">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-100 mb-1">Plugin Manager</h1>
            <p className="text-gray-500 text-sm">
              Browse, install, and manage plugins to extend Aether functionality
            </p>
          </div>
          <div className="text-xs text-gray-500 bg-[#14141a] border border-[#1e1e24] rounded-lg px-3 py-1.5">
            {installed.length} plugin{installed.length !== 1 ? "s" : ""} installed
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md mt-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            className="w-full text-xs bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg pl-8 pr-3 py-1.5 outline-none focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" className="text-gray-500" />
            <path d="M8.5 8.5L11 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="text-gray-500" />
          </svg>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === tab.id
                  ? "bg-[#a78bfa]/10 text-[#a78bfa] border border-[#a78bfa]/20"
                  : "text-gray-400 hover:text-gray-200 border border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {/* ────────────────────────────────────────
                    TAB: INSTALLED
                   ──────────────────────────────────────── */}
        {activeTab === "installed" && (
          <div className="max-w-4xl space-y-3">
            {filteredInstalled.length === 0 ? (
              <div className="flex items-center justify-center h-32 bg-[#14141a] border border-dashed border-[#2a2a33] rounded-2xl">
                <p className="text-gray-600 text-sm">
                  {searchQuery
                    ? "No installed plugins match your search."
                    : "No plugins installed. Browse the Discover tab to find plugins."}
                </p>
              </div>
            ) : (
              filteredInstalled.map((plugin) => (
                <div key={plugin.manifest.id} className="group relative">
                  <InstalledPluginCard
                    plugin={plugin}
                    onToggle={handleToggle}
                    onConfigChange={handleConfigChange}
                  />
                  {/* Remove button */}
                  <button
                    onClick={() => handleRemove(plugin.manifest.id)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-red-400 hover:text-red-300 bg-[#1e1e24] border border-red-400/20 rounded px-2 py-0.5"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* ────────────────────────────────────────
                    TAB: DISCOVER
                   ──────────────────────────────────────── */}
        {activeTab === "discover" && (
          <div>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                Plugin Marketplace
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Explore community and official plugins to extend Aether
              </p>
            </div>
            {filteredMarketplace.length === 0 ? (
              <div className="flex items-center justify-center h-32 bg-[#14141a] border border-dashed border-[#2a2a33] rounded-2xl">
                <p className="text-gray-600 text-sm">No marketplace plugins match your search.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-4xl">
                {filteredMarketplace.map((plugin) => (
                  <MarketplaceCard
                    key={plugin.id}
                    plugin={plugin}
                    installed={marketplaceInstalled.has(plugin.id)}
                    onInstall={handleInstall}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ────────────────────────────────────────
                    TAB: SETTINGS
                   ──────────────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="max-w-2xl">
            <div className="bg-[#14141a] border border-[#1e1e24] rounded-xl overflow-hidden divide-y divide-[#1e1e24]">
              {/* Plugin Directory */}
              <div className="flex items-center justify-between px-5 py-3.5 hover:bg-[#ffffff06] transition-colors">
                <div className="min-w-0 flex-1 mr-4">
                  <p className="text-sm font-medium text-gray-200">Plugin Directory</p>
                  <p className="text-xs text-gray-500 mt-0.5">Directory where plugins are loaded from</p>
                </div>
                <div className="flex-shrink-0">
                  <SettingsInput
                    value={pl.pluginDir}
                    onChange={(v) => updatePlugins({ pluginDir: v })}
                    placeholder="./plugins"
                    monospace
                  />
                </div>
              </div>

              {/* Auto-load Plugins */}
              <div className="flex items-center justify-between px-5 py-3.5 hover:bg-[#ffffff06] transition-colors">
                <div className="min-w-0 flex-1 mr-4">
                  <p className="text-sm font-medium text-gray-200">Auto-Load Plugins</p>
                  <p className="text-xs text-gray-500 mt-0.5">Automatically load enabled plugins on startup</p>
                </div>
                <div className="flex-shrink-0">
                  <SettingsToggle
                    checked={pl.autoLoadPlugins}
                    onChange={(v) => updatePlugins({ autoLoadPlugins: v })}
                  />
                </div>
              </div>

              {/* Enabled Plugins */}
              <div className="flex items-center justify-between px-5 py-3.5 hover:bg-[#ffffff06] transition-colors">
                <div className="min-w-0 flex-1 mr-4">
                  <p className="text-sm font-medium text-gray-200">Enabled Plugins</p>
                  <p className="text-xs text-gray-500 mt-0.5">Plugins currently enabled (managed via Installed tab)</p>
                </div>
                <div className="flex-shrink-0">
                  <span className="text-xs font-mono text-gray-400 bg-[#1e1e24] px-2 py-1 rounded-lg border border-[#2a2a33]">
                    {pl.enabledPlugins.length > 0
                      ? pl.enabledPlugins.join(", ")
                      : "None"}
                  </span>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="mt-6 flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {installed.filter((p) => p.enabled).length} enabled
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-600" />
                {installed.filter((p) => !p.enabled).length} disabled
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[#a78bfa]" />
                {marketplaceInstalled.size - installed.length} pending install
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
