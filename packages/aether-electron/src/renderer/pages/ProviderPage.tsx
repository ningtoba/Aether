import React, { useState, useCallback } from "react";

// ─── Types (mirrors @aether/providers types) ─────────────────────

type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "vllm"
  | "llamacpp"
  | "openrouter"
  | "custom";

type HealthStatus = "connected" | "disconnected" | "error" | "unknown";

interface ProviderModel {
  name: string;
  contextWindow: number;
  capabilities: string[];
}

interface ProviderEntry {
  id: string;
  name: string;
  type: ProviderName;
  baseUrl: string;
  defaultModel: string;
  models: ProviderModel[];
  enabled: boolean;
  status: HealthStatus;
  lastChecked: Date | null;
  errorMessage?: string;
}

interface ProviderForm {
  name: string;
  type: ProviderName;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

// ─── Mock data ──────────────────────────────────────────────────

const MOCK_MODELS: Record<ProviderName, ProviderModel[]> = {
  openai: [
    { name: "gpt-4.1", contextWindow: 1_000_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision"] },
    { name: "gpt-4o", contextWindow: 128_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision"] },
    { name: "gpt-4o-mini", contextWindow: 128_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision"] },
    { name: "o3-mini", contextWindow: 200_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "reasoning"] },
    { name: "text-embedding-3-small", contextWindow: 8_191, capabilities: ["embeddings"] },
  ],
  anthropic: [
    { name: "claude-sonnet-4", contextWindow: 200_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision"] },
    { name: "claude-opus-4", contextWindow: 200_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision", "reasoning"] },
    { name: "claude-haiku-3-5", contextWindow: 200_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision"] },
  ],
  gemini: [
    { name: "gemini-2.5-pro", contextWindow: 1_000_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision", "audio"] },
    { name: "gemini-2.5-flash", contextWindow: 1_000_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "json_mode", "vision", "audio"] },
  ],
  ollama: [
    { name: "llama3.1:8b", contextWindow: 8_192, capabilities: ["chat", "streaming"] },
    { name: "mistral:7b", contextWindow: 8_192, capabilities: ["chat", "streaming"] },
    { name: "codellama:13b", contextWindow: 16_384, capabilities: ["chat", "completion"] },
  ],
  vllm: [
    { name: "mistralai/Mistral-7B-Instruct-v0.3", contextWindow: 32_768, capabilities: ["chat", "streaming", "function_calling"] },
  ],
  llamacpp: [
    { name: "llama-2-7b.Q4_K_M.gguf", contextWindow: 4_096, capabilities: ["chat", "completion"] },
  ],
  openrouter: [
    { name: "anthropic/claude-sonnet-4", contextWindow: 200_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "vision"] },
    { name: "openai/gpt-4o", contextWindow: 128_000, capabilities: ["chat", "streaming", "function_calling", "tool_use", "vision"] },
    { name: "google/gemini-2.5-pro", contextWindow: 1_000_000, capabilities: ["chat", "streaming", "function_calling", "vision"] },
  ],
  custom: [
    { name: "custom-model", contextWindow: 8_192, capabilities: ["chat", "streaming"] },
  ],
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  ollama: "Ollama",
  vllm: "vLLM",
  llamacpp: "llama.cpp",
  openrouter: "OpenRouter",
  custom: "Custom REST",
};

const PROVIDER_DEFAULT_URLS: Record<ProviderName, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://localhost:11434",
  vllm: "http://localhost:8000/v1",
  llamacpp: "http://localhost:8080/v1",
  openrouter: "https://openrouter.ai/api/v1",
  custom: "",
};

const MOCK_PROVIDERS: ProviderEntry[] = [
  {
    id: "prov-1",
    name: "OpenAI Production",
    type: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: MOCK_MODELS.openai,
    enabled: true,
    status: "connected",
    lastChecked: new Date(Date.now() - 1000 * 60 * 5),
  },
  {
    id: "prov-2",
    name: "Anthropic Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4",
    models: MOCK_MODELS.anthropic,
    enabled: true,
    status: "connected",
    lastChecked: new Date(Date.now() - 1000 * 60 * 12),
  },
  {
    id: "prov-3",
    name: "Local Ollama",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    defaultModel: "llama3.1:8b",
    models: MOCK_MODELS.ollama,
    enabled: true,
    status: "connected",
    lastChecked: new Date(Date.now() - 1000 * 30),
  },
  {
    id: "prov-4",
    name: "Gemini Pro",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-pro",
    models: MOCK_MODELS.gemini,
    enabled: false,
    status: "unknown",
    lastChecked: null,
  },
  {
    id: "prov-5",
    name: "OpenRouter",
    type: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    models: MOCK_MODELS.openrouter,
    enabled: true,
    status: "error",
    lastChecked: new Date(Date.now() - 1000 * 60 * 60),
    errorMessage: "Rate limit exceeded (429)",
  },
  {
    id: "prov-6",
    name: "vLLM Server",
    type: "vllm",
    baseUrl: "http://localhost:8000/v1",
    defaultModel: "mistralai/Mistral-7B-Instruct-v0.3",
    models: MOCK_MODELS.vllm,
    enabled: true,
    status: "disconnected",
    lastChecked: new Date(Date.now() - 1000 * 60 * 2),
    errorMessage: "Connection refused",
  },
];

// ─── Helpers ────────────────────────────────────────────────────

const PROVIDER_TYPE_OPTIONS: { value: ProviderName; label: string }[] = [
  { value: "openai", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "ollama", label: "Ollama" },
  { value: "vllm", label: "vLLM" },
  { value: "llamacpp", label: "llama.cpp" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "gemini", label: "Google Gemini" },
  { value: "custom", label: "Custom REST" },
];

function getStatusColor(status: HealthStatus): string {
  switch (status) {
    case "connected":    return "bg-green-500";
    case "disconnected": return "bg-yellow-500";
    case "error":        return "bg-red-500";
    case "unknown":      return "bg-gray-500";
  }
}

function getStatusLabel(status: HealthStatus): string {
  switch (status) {
    case "connected":    return "Connected";
    case "disconnected": return "Disconnected";
    case "error":        return "Error";
    case "unknown":      return "Unknown";
  }
}

function formatTimestamp(date: Date | null): string {
  if (!date) return "Never";
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function getTypeIcon(type: ProviderName): string {
  switch (type) {
    case "openai":    return "⚡";
    case "anthropic": return "🧠";
    case "gemini":    return "🔮";
    case "ollama":    return "🦙";
    case "vllm":      return "🚀";
    case "llamacpp":  return "🖥️";
    case "openrouter": return "🌐";
    case "custom":    return "🔧";
  }
}

// ─── Modal component ────────────────────────────────────────────

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1a1a22] border border-[#2a2a33] rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a33] shrink-0">
          <h2 className="text-lg font-bold text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Form Fields ────────────────────────────────────────────────

interface FieldProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function Field({ label, description, children }: FieldProps) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {description && <p className="text-xs text-gray-500 mb-1.5">{description}</p>}
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  monospace,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  monospace?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-sm bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20 ${monospace ? "font-mono" : ""}`}
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-sm bg-[#1e1e24] border border-[#2a2a33] text-gray-200 rounded-lg px-3 py-2 outline-none focus:border-[#a78bfa]/50 focus:ring-1 focus:ring-[#a78bfa]/20"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
        checked ? "bg-[#a78bfa]" : "bg-[#2a2a33]"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

// ─── Capability Badge ───────────────────────────────────────────

function CapabilityBadge({ name }: { name: string }) {
  const colorMap: Record<string, string> = {
    chat: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    streaming: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
    function_calling: "bg-purple-500/15 text-purple-400 border-purple-500/25",
    tool_use: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25",
    json_mode: "bg-teal-500/15 text-teal-400 border-teal-500/25",
    vision: "bg-green-500/15 text-green-400 border-green-500/25",
    reasoning: "bg-orange-500/15 text-orange-400 border-orange-500/25",
    audio: "bg-pink-500/15 text-pink-400 border-pink-500/25",
    embeddings: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
    completion: "bg-rose-500/15 text-rose-400 border-rose-500/25",
  };
  const cls = colorMap[name] || "bg-gray-500/15 text-gray-400 border-gray-500/25";
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${cls}`}>
      {name.replace(/_/g, " ")}
    </span>
  );
}

// ─── Provider Card ──────────────────────────────────────────────

interface ProviderCardProps {
  entry: ProviderEntry;
  onEdit: (entry: ProviderEntry) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onHealthCheck: (id: string) => void;
}

function ProviderCard({ entry, onEdit, onToggle, onDelete, onHealthCheck }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`bg-[#14141a] border rounded-xl transition-all ${
        entry.enabled
          ? "border-[#1e1e24] hover:border-[#2a2a33]"
          : "border-[#1a1a22] opacity-70 hover:opacity-90"
      }`}
    >
      {/* ── Card Header ── */}
      <div className="px-5 py-4 flex items-center gap-4">
        {/* Type icon */}
        <div className="text-2xl shrink-0">{getTypeIcon(entry.type)}</div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-100 truncate">{entry.name}</h3>
            <span className="text-[10px] font-medium text-gray-500 bg-[#1e1e24] px-1.5 py-0.5 rounded">
              {PROVIDER_LABELS[entry.type]}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor(entry.status)}`} />
            <span className={`text-xs font-medium ${
              entry.status === "connected" ? "text-green-400" :
              entry.status === "error" ? "text-red-400" :
              entry.status === "disconnected" ? "text-yellow-400" :
              "text-gray-400"
            }`}>
              {getStatusLabel(entry.status)}
            </span>
            <span className="text-[11px] text-gray-600">·</span>
            <span className="text-[11px] text-gray-500">{entry.models.length} model{entry.models.length !== 1 ? "s" : ""}</span>
            {!entry.enabled && (
              <>
                <span className="text-[11px] text-gray-600">·</span>
                <span className="text-[11px] text-amber-500">Disabled</span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onHealthCheck(entry.id)}
            title="Check health"
            className="p-1.5 text-gray-500 hover:text-green-400 transition-colors rounded-lg hover:bg-[#1e1e24]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3V8L10.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onEdit(entry)}
            title="Edit provider"
            className="p-1.5 text-gray-500 hover:text-[#a78bfa] transition-colors rounded-lg hover:bg-[#1e1e24]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M11.5 2.5L13.5 4.5L6 12H4V10L11.5 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
          <Toggle checked={entry.enabled} onChange={() => onToggle(entry.id)} />
        </div>
      </div>

      {/* ── Health info bar ── */}
      {entry.lastChecked && (
        <div className="px-5 pb-1">
          <div className="flex items-center gap-2 text-[11px] text-gray-500">
            <span>Last checked: {formatTimestamp(entry.lastChecked)}</span>
            {entry.baseUrl && (
              <>
                <span>·</span>
                <span className="font-mono truncate max-w-[200px]" title={entry.baseUrl}>
                  {entry.baseUrl}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Error message ── */}
      {entry.status === "error" && entry.errorMessage && (
        <div className="px-5 pb-2">
          <div className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/8 px-2.5 py-1 rounded-md">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" />
              <path d="M6 3.5V6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
            </svg>
            {entry.errorMessage}
          </div>
        </div>
      )}

      {/* ── Default model & expand ── */}
      <div className="px-5 pb-3 flex items-center justify-between">
        <div className="text-[11px] text-gray-500">
          Default model: <span className="font-mono text-gray-400">{entry.defaultModel}</span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] text-[#a78bfa] hover:text-[#c4b5fd] transition-colors flex items-center gap-1"
        >
          {expanded ? "Hide models" : "Show models"}
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* ── Expanded models ── */}
      {expanded && (
        <div className="border-t border-[#1e1e24] px-5 py-3 space-y-2">
          {entry.models.map((model) => (
            <div key={model.name} className="bg-[#1a1a22] rounded-lg p-3 border border-[#25252e]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-mono font-medium text-gray-200">{model.name}</span>
                <span className="text-[10px] text-gray-500">
                  {(model.contextWindow / 1000).toFixed(0)}k ctx
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {model.capabilities.map((cap) => (
                  <CapabilityBadge key={cap} name={cap} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Delete button ── */}
      <div className="border-t border-[#1e1e24] px-5 py-2 flex justify-end">
        <button
          type="button"
          onClick={() => onDelete(entry.id)}
          className="text-[11px] text-gray-600 hover:text-red-400 transition-colors"
        >
          Remove provider
        </button>
      </div>
    </div>
  );
}

// ─── Add/Edit Form ──────────────────────────────────────────────

interface ProviderFormProps {
  initial?: ProviderForm;
  onSave: (form: ProviderForm) => void;
  onCancel: () => void;
}

function ProviderFormModal({ initial, onSave, onCancel }: ProviderFormProps) {
  const [form, setForm] = useState<ProviderForm>(
    initial ?? {
      name: "",
      type: "openai",
      baseUrl: PROVIDER_DEFAULT_URLS.openai,
      apiKey: "",
      defaultModel: "",
      enabled: true,
    },
  );

  const isEditing = !!initial;

  const handleTypeChange = (type: string) => {
    const t = type as ProviderName;
    setForm((f) => ({
      ...f,
      type: t,
      baseUrl: PROVIDER_DEFAULT_URLS[t],
    }));
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave(form);
  };

  const isValid = form.name.trim().length > 0;

  return (
    <Modal title={isEditing ? "Edit Provider" : "Add Provider"} onClose={onCancel}>
      <div className="space-y-1">
        <Field label="Provider Name" description="A friendly name to identify this provider">
          <TextInput
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="e.g. OpenAI Production"
          />
        </Field>

        <Field label="Provider Type">
          <Select value={form.type} options={PROVIDER_TYPE_OPTIONS} onChange={handleTypeChange} />
        </Field>

        <Field label="API Endpoint URL" description="The base URL for API requests">
          <TextInput
            value={form.baseUrl}
            onChange={(v) => setForm((f) => ({ ...f, baseUrl: v }))}
            placeholder="https://api.openai.com/v1"
            monospace
          />
        </Field>

        <Field label="API Key" description="Stored securely in the system keychain">
          <TextInput
            type="password"
            value={form.apiKey}
            onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))}
            placeholder={isEditing ? "•••••••• (unchanged if empty)" : "sk-..."}
            monospace
          />
        </Field>

        <Field label="Default Model" description="Default model for completions">
          <TextInput
            value={form.defaultModel}
            onChange={(v) => setForm((f) => ({ ...f, defaultModel: v }))}
            placeholder="gpt-4o"
            monospace
          />
        </Field>

        <Field label="Enabled">
          <div className="flex items-center gap-2">
            <Toggle
              checked={form.enabled}
              onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
            <span className="text-xs text-gray-400">
              {form.enabled ? "Provider is active" : "Provider is disabled"}
            </span>
          </div>
        </Field>

        {/* ── Buttons ── */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#2a2a33] mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors px-4 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isValid}
            className="text-sm font-medium text-white bg-[#a78bfa] hover:bg-[#b99cfb] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
          >
            {isEditing ? "Save Changes" : "Add Provider"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main ProviderPage ──────────────────────────────────────────

export function ProviderPage() {
  const [providers, setProviders] = useState<ProviderEntry[]>(MOCK_PROVIDERS);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ProviderEntry | null>(null);

  // ── Handlers ──

  const handleAdd = useCallback(() => {
    setEditingEntry(null);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((entry: ProviderEntry) => {
    setEditingEntry(entry);
    setShowForm(true);
  }, []);

  const handleSave = useCallback((form: ProviderForm) => {
    if (editingEntry) {
      // Edit existing
      setProviders((prev) =>
        prev.map((p) =>
          p.id === editingEntry.id
            ? {
                ...p,
                name: form.name,
                type: form.type,
                baseUrl: form.baseUrl,
                defaultModel: form.defaultModel,
                enabled: form.enabled,
                models: MOCK_MODELS[form.type],
                // Reset status on type/url change
                status: "unknown" as HealthStatus,
                lastChecked: null,
                errorMessage: undefined,
              }
            : p,
        ),
      );
    } else {
      // Add new
      const newEntry: ProviderEntry = {
        id: `prov-${Date.now()}`,
        name: form.name,
        type: form.type,
        baseUrl: form.baseUrl,
        defaultModel: form.defaultModel || MOCK_MODELS[form.type][0]?.name || "",
        models: MOCK_MODELS[form.type],
        enabled: form.enabled,
        status: "unknown",
        lastChecked: null,
      };
      setProviders((prev) => [...prev, newEntry]);
    }
    setShowForm(false);
    setEditingEntry(null);
  }, [editingEntry]);

  const handleToggle = useCallback((id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleHealthCheck = useCallback((id: string) => {
    // Simulate health check
    setProviders((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;

        // Random health result
        const outcomes: HealthStatus[] = ["connected", "disconnected", "error"];
        const status = outcomes[Math.floor(Math.random() * outcomes.length)];

        return {
          ...p,
          status,
          lastChecked: new Date(),
          errorMessage:
            status === "error"
              ? "Connection timeout (simulated)"
              : status === "disconnected"
                ? "Could not reach endpoint"
                : undefined,
        };
      }),
    );
  }, []);

  const connectedCount = providers.filter((p) => p.status === "connected").length;
  const errorCount = providers.filter((p) => p.status === "error").length;
  const totalEnabled = providers.filter((p) => p.enabled).length;

  return (
    <div className="provider-page h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-8 pt-8 pb-4 border-b border-[#1e1e24]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-100 mb-1">Provider Management</h1>
            <p className="text-gray-500 text-sm">
              Configure and manage AI providers (OpenAI, Anthropic, local models, etc.)
            </p>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-[#a78bfa] hover:bg-[#b99cfb] px-4 py-2 rounded-lg transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2V12M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add Provider
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            {connectedCount} connected
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            {errorCount} errors
          </span>
          <span>{totalEnabled} enabled</span>
          <span>{providers.length} total</span>
        </div>
      </div>

      {/* ── Provider List ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-4xl space-y-3">
          {providers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3">🔌</div>
              <p className="text-gray-400 text-sm mb-1">No providers configured</p>
              <p className="text-gray-600 text-xs mb-4">
                Add an AI provider to start using language models
              </p>
              <button
                type="button"
                onClick={handleAdd}
                className="text-sm font-medium text-white bg-[#a78bfa] hover:bg-[#b99cfb] px-4 py-2 rounded-lg transition-colors"
              >
                Add Your First Provider
              </button>
            </div>
          ) : (
            providers.map((entry) => (
              <ProviderCard
                key={entry.id}
                entry={entry}
                onEdit={handleEdit}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onHealthCheck={handleHealthCheck}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Add/Edit Modal ── */}
      {showForm && (
        <ProviderFormModal
          initial={
            editingEntry
              ? {
                  name: editingEntry.name,
                  type: editingEntry.type,
                  baseUrl: editingEntry.baseUrl,
                  apiKey: "",
                  defaultModel: editingEntry.defaultModel,
                  enabled: editingEntry.enabled,
                }
              : undefined
          }
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingEntry(null); }}
        />
      )}
    </div>
  );
}
