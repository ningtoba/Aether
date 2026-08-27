# Aether Architecture

**Version:** 0.1.0  
**Last Updated:** 2026-05-20

## Overview

Aether is a full-stack autonomous AI orchestration platform. It manages LLM provider connections, multi-agent workflows, memory systems, tool execution environments, and provides a desktop GUI for configuration and monitoring — all self-hosted with no external API dependencies by default.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      aether-electron                          │
│                    (Electron Shell)                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                 aether-backend                          │  │
│  │   HTTP Server (Node.js http module)                    │  │
│  │   REST API + WebSocket for exec logs                   │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-core     │  │  aether-orchestrator     │    │  │
│  │  │  Event bus       │  │  LangGraph DAG engine    │    │  │
│  │  │  Lifecycle mgr   │  │  WorkflowBuilder API     │    │  │
│  │  │  Config manager  │  │  Visualizer (Mermaid)    │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-providers│  │  aether-memory           │    │  │
│  │  │  Anthropic       │  │  In-memory vector store  │    │  │
│  │  │  Gemini          │  │  Memory store (keyword)  │    │  │
│  │  │  Ollama/vLLM/    │  │  RAG engine (hybrid)     │    │  │
│  │  │  llama.cpp/OR    │  └─────────────────────────┘    │  │
│  │  └──────────────────┘                                 │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-tools    │  │  aether-telemetry        │    │  │
│  │  │  Tool registry   │  │  OpenTelemetry tracing   │    │  │
│  │  │  Shell executor  │  │  Pino logging + metrics  │    │  │
│  │  │  File editor     │  └─────────────────────────┘    │  │
│  │  └──────────────────┘                                 │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-security │  │  aether-sdk              │    │  │
│  │  │  RBAC (5 roles)  │  │  AetherAgent/Runner      │    │  │
│  │  │  Hierarchical    │  │  ToolRegistry            │    │  │
│  │  │  Glob resource   │  │  Handoff support         │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-types    │  │  aether-utils            │    │  │
│  │  │  Shared types    │  │  Helpers, validators     │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────┐           │
│  │          aether-frontend / React renderer      │           │
│  │  React 19 with TailwindCSS 4 + Framer Motion  │           │
│  │  8 pages tabbed via sidebar navigation:        │           │
│  │  Dashboard, Providers, Agents, Workflows,      │           │
│  │  Memory, Executions, Plugins, Settings         │           │
│  └───────────────────────────────────────────────┘           │
│                                                              │
│  ┌───────────────────────────────────────────────┐           │
│  │  Execution Sandboxes (outside backend)         │           │
│  │  ┌──────┐  ┌──────────┐  ┌──────────┐ ┌────┐ │           │
│  │  │Docker│  │ts-runtime│  │python-venv│ │PW  │ │           │
│  │  └──────┘  └──────────┘  └──────────┘ └────┘ │           │
│  └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

---

## Package Map

### `@aether/core` — Runtime Foundation
- Typed event bus (pub/sub with async/retry modes)
- Configuration manager with generic type support and defaults
- Lifecycle manager (5-stage state machine: init → ready → running → stopping → stopped)
- Hook system for lifecycle transitions

### `@aether/providers` — LLM Provider Abstraction
- Provider registry with lazy initialization and dynamic type registration
- Built-in providers: Anthropic (Messages API), Gemini, Ollama, vLLM, llama.cpp, OpenRouter, OpenAI-compatible
- Unified interface: `complete()`, `completeStream()`, `embed()`, `listModels()`, `healthCheck()`
- Encrypted vault for API key storage (OS keychain via keytar, AES-256-GCM file fallback)
- Model capability registry for feature detection

### `@aether/orchestrator` — Multi-Agent Workflows
- LangGraph engine wrapper with StateGraph integration
- Fluent WorkflowBuilder: agentNode, routerNode, mapNode, reduceNode, connect, connectIf, connectViaLLM
- In-memory checkpointing with save/get/list/delete
- Mutable graph editor for runtime modifications
- Visualizer: Mermaid.js, DOT (Graphviz), and text tree representations
- Execution state machine tracking node-level status, history, and accumulated data

### `@aether/memory` — Memory & Knowledge
- MemoryStore: In-memory key-value store with keyword scoring, type/metadata filtering, TTL expiry, max capacity compaction
- InMemoryVectorStore: Map-based brute-force cosine search with configurable dimensions
- RAGEngine: Document chunking (fixed/sentence/paragraph with overlap), hybrid retrieval (keyword + vector, 1.2x keyword boost), deduplication
- Configurable embedding simulation for local-only operation

### `@aether/tools` — Tool Execution

- Tool registry with register/get/list/remove
- Docker container sandbox via Dockerode SDK (create/destroy/exec with resource profiles)
- Shell command executor with configurable timeouts
- File editor tool (read/write/edit files within allowed paths)
- Resource profiles: minimal/standard/high/unrestricted
- Environment injection, timeout handling, output size limits

### `@aether/telemetry` — Observability
- OpenTelemetry tracing (BasicTracerProvider, console + OTLP exporters)
- Pino structured logging with automatic OTel trace context injection
- Metrics registry: counters, gauges, histograms with percentile computation
- Semantic attributes and span names conventions
- W3C trace context propagation for distributed tracing

### `@aether/types` — Shared Type Definitions
- `LLMProvider` — provider connection config with 8 provider types
- `MemoryConfig` — vector store / embedding settings
- `AgentConfig` — full agent definition (prompt, model, tools)
- `WorkflowConfig` — DAG of nodes and edges
- `OrchestrationConfig` — multi-agent orchestration plan
- `Execution` — run state, logs, timestamps
- `ToolConfig` — tool binding with typed parameters
- `SandboxLimits` / `SandboxProfile` — sandbox resource constraints
- `Base` types — UUID, SemVer, Timestamp, JSON, enums, pagination, error details

### `@aether/utils` — Utilities
- Cryptography (key generation, ID generation)
- String manipulation (truncate, slugify, capitalize, escapeHtml, template)
- Object deep merge / clone / pick / omit / equality
- Async (delay, timeout, retry with 3 backoff strategies, parallel with concurrency, race)
- JSON schema validation (URL, port, string, object)
- Platform detection (Electron, Node.js, OS)
- Structured logger (levels, formats, child loggers)

### `@aether/sdk` — Public API for External Consumers

- AetherAgent wrapping OpenAI Agents SDK Agent (instructions, model, tools, handoffs)
- AetherRunner with AetherModelProvider bridging — execute agents with any configured LLM provider
- ToolRegistry — register/lookup/execute tools, convert between Aether and SDK tool schemas
- Handoff support between agents with type-safe handoff definitions
- Message conversion utilities for cross-format compatibility

### `@aether/security` — RBAC
- Hierarchical roles with inheritance
- 5 built-in roles: admin, operator, developer, agent, viewer
- Glob-based resource pattern matching
- Permission resolution with specificity sorting
- Deny-by-default security model

### `@aether/backend` — HTTP Server
- Node.js built-in http module (no framework dependency)
- Pattern-matched router with `:param` placeholders
- Native WebSocket implementation (RFC 6455 frame encoding/decoding)
- In-memory agent, provider, and execution stores
- CORS support with configurable origins
- Health check with memory/uptime/providers status

### `@aether/frontend` — React Admin GUI (Electron Renderer)

- React 19 with TypeScript, TailwindCSS 4, Framer Motion animations
- **8 pages** routed via a simple page-state switch in `App.tsx`:
  - `DashboardPage` — system info (platform, arch, version, CPU, memory, GPU), agent overview cards with status indicators, recent executions table, quick stats bar
  - `ProviderPage` — list/add/configure LLM providers, health checks
  - `AgentPage` — agent CRUD, model selection, prompt configuration
  - `WorkflowPage` — visual workflow builder with DAG editing
  - `MemoryPage` — memory stats, search/query interface, vector store browser
  - `ExecutionPage` — execution listing, live status, logs viewer
  - `PluginPage` — plugin install/uninstall, browse available plugins
  - `SettingsPage` — 13 settings categories via Zustand persist store
- **Components**: `SettingsSection`/`SettingsRow` containers, `SettingsToggle` (switch), `SettingsSelect` (dropdown), `SettingsInput` (text/password/number), `SettingsSlider` (range), `SettingsTagGroup` (multi-select chips), `SettingsKeyValueEditor`, `SettingsButton` (default/danger/primary variants)
- **Navigation**: `Sidebar` component with 8 icon-labeled navigation items, active state highlighting, logo area
- **Window chrome**: `TitleBar` component with custom minimize/maximize/close buttons using SVG icons, maximized state awareness via IPC
- **State management**: Zustand store with `persist` middleware for settings persistence, local React state for page-specific data
- **Data connections**: All pages wire to `window.electronAPI` IPC bridge methods (getSystemInfo, listAgents, listProviders, listExecutions, etc.), with fallback states when bridge is unavailable

### `aether-electron` — Desktop Shell
- Main process with single-instance lock and window management
- System tray with context menu
- Auto-updater with electron-updater (GitHub releases)
- Crash reporter with log rotation (10MB max)
- GPU feature flags for hardware acceleration
- preload.ts contextBridge API
- electron-vite build configuration

### `@aether/docker` — Docker Sandbox
- Container lifecycle management (create, destroy via CLI)
- Resource-constrained execution with profile presets
- File injection and command execution
- Health check / availability verification

### `@aether/ts-runtime` — TypeScript Runtime Sandbox
- Isolated child process execution via tsx
- Timeout-enforced execution with SIGTERM/SIGKILL cascade
- Output size limits to prevent memory exhaustion
- `execTypeScript()` — run code, capture stdout/stderr/exitCode
- `evalTypeScript()` — run code and parse JSON result with context injection
- Temp file cleanup on completion

### `@aether/python-venv` — Python Virtual Environment Management
- `createVenv()` — create Python 3 virtual environments
- `installPackages()` — pip install within a venv
- `runPython()` / `runPythonCode()` — execute files or inline code
- `getInstalledPackages()` — list installed packages via pip JSON output
- `deleteVenv()` — remove a virtual environment
- Cross-platform (Windows/Unix) venv path resolution

### `@aether/playwright` — Browser Automation
- `launchBrowser()` — launch Chromium, Firefox, or WebKit (headless by default)
- `createPage()` / `navigate()` — page creation and navigation
- `screenshot()` — take page screenshots (file or Buffer)
- `evaluate()` — execute JavaScript in page context
- `click()` / `type()` / `getContent()` / `getPageTitle()` — interaction helpers
- Lazy dynamic import of playwright-core (graceful without dependency)

---

## Data Flow

```
User Input
    │
    ▼
aether-backend (REST / WS)
    │
    ├─► aether-security (RBAC auth check)
    │
    ▼
aether-orchestrator
    │
    ├─► aether-core (event bus, lifecycle, config)
    ├─► aether-providers (LLM calls)
    ├─► aether-memory (retrieve / store)
    ├─► aether-tools (sandbox execution)
    │
    ▼
Response ──► aether-telemetry (log, trace)
    │
    ▼
Admin GUI / Electron (display)
```

### Execution Flow (detailed)

1. **API Layer** receives an agent execution request (`POST /api/executions`). Authentication/RBAC is planned, not yet implemented (see Security Model)
2. **Orchestrator** resolves orchestration mode from workflow definition and agent configs
3. **Provider** makes LLM calls with configured model (chat, stream, or embeddings)
4. **Tool Execution** runs any tool calls the LLM generates (Docker sandbox or local)
5. **Memory** retrieves relevant context via hybrid search before each step, stores results
6. **Telemetry** records everything as structured spans and metrics
7. **Response** streams back via WebSocket or returns as complete payload

---

## Electron IPC Bridge

The Electron shell uses a typed IPC (Inter-Process Communication) protocol to bridge the renderer process (React GUI) with the main process (backend data).

### Architecture

```
┌─────────────────────────────────────────────────┐
│             Renderer Process (React)             │
│                                                  │
│  window.electronAPI.getSystemInfo()               │
│  window.electronAPI.listAgents()                  │
│  window.electronAPI.listProviders()               │
│  ...                                              │
│         │                                         │
│         ▼ (contextBridge + ipcRenderer)           │
│  ┌─────────────────────────────────────────────┐  │
│  │           Main Process                      │  │
│  │                                             │  │
│  │  ipc-main → ipc-handlers.ts                │  │
│  │      (channel routing)                     │  │
│  │         │                                   │  │
│  │         ▼                                   │  │
│  │  backend-bridge.ts                          │  │
│  │  (in-memory stores, mirrors API routes)     │  │
│  │  ─ agents, providers, executions,           │  │
│  │    plugins, memory, health                  │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### IPC Channels

The protocol is defined in `packages/aether-electron/src/shared/ipc-protocol.ts` with typed handler signatures:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-version` / `app:get-platform` | Renderer → Main | App metadata |
| `system:get-info` / `gpu:get-info` | Renderer → Main | System diagnostics |
| `backend:health` | Renderer → Main | Backend health check |
| `agents:*` | Renderer → Main | CRUD for agent records |
| `providers:*` | Renderer → Main | Provider management |
| `executions:*` | Renderer → Main | Execution lifecycle |
| `plugins:*` | Renderer → Main | Plugin install/uninstall |
| `memory:*` | Renderer → Main | Memory stats, search, clear |
| `window:*` | Renderer → Main | Window controls (minimize, maximize, close) |
| `update:*` | Main → Renderer | Auto-updater events (available, downloading, error) |
| `window:maximize-changed` | Main → Renderer | Maximize state events |

### Data Flow (Electron)

1. **Renderers** invoke API via `window.electronAPI` (exposed through contextBridge preload script)
2. **Main process** receives IPC messages via `ipcMain.handle()` / `ipcMain.on()`
3. **backend-bridge.ts** provides in-memory data stores (agents, providers, etc.) mirroring the backend REST API routes
4. **Responses** flow back through IPC to the renderer, which updates React state
5. This design allows swapping the in-memory bridge for real HTTP calls to `aether-backend` when running in server mode

---

## Configuration

Aether reads configuration from (in order of precedence):
1. CLI flags
2. Environment variables (`AETHER_*`)
3. Config file (`aether.config.json` or `aether.config.yaml`)
4. Defaults

Key configuration domains:
- `providers` — LLM provider definitions (type, API key, endpoint, model)
- `agents` — agent definitions (instructions, model, tools, handoffs)
- `orchestration` — orchestration plans (timeout, parallelism, retry policy)
- `memory` — storage backend config (type, embedding, chunking)
- `tools` — sandbox and tool config (Docker, browser)
- `server` — HTTP server settings (port, host, CORS)
- `logging` — telemetry and log level (Pino, OTel)

---

## Security Model

Current state (honest):

- **Sandboxed execution** — Tools run in Docker containers with resource limits
- **WebSocket hardening** — RFC 6455 frame reassembly, length/memory bounds, masked-frame enforcement, Origin allow-list (see README v0.1.1)
- **Request body limits** — 1 MB default, configurable `MAX_BODY_SIZE`, enforced for Content-Length and chunked bodies
- **RBAC** — `aether-security` provides role-based access control with 5 built-in roles, but it is **not yet wired** into the HTTP API
- **Provider key isolation** — OS keychain via keytar when available; otherwise an AES-256-GCM encrypted file at `~/.config/aether/vault.enc` (machine-key derived, owner-only perms, atomic writes). Legacy plaintext stores are migrated and removed on upgrade.

Planned (not yet implemented): per-request API authentication (JWT/API keys), per-API-key rate limiting, path allow-listing enforcement, encrypted provider-key storage. **Do not deploy the API on an untrusted network — it is unauthenticated.**

---

## Extension Points

### Plugins (planned)
Plugins can hook into any lifecycle event:
- `core:beforeInit` / `core:afterInit`
- `provider:beforeChat` / `provider:afterChat`
- `orchestrator:beforeStep` / `orchestrator:afterStep`
- `tool:beforeExecute` / `tool:afterExecute`
- `server:routeRegister`

Plugin types:
- **tool** — add new tool implementations
- **provider** — add LLM provider backends
- **hook** — attach to lifecycle events
- **middleware** — intercept HTTP requests

### SDK
External applications can use `@aether/sdk` to create agents, run executions, and register webhooks programmatically.

---

## Docker Deployment

Aether ships with a production-ready `Dockerfile` and `docker-compose.yml` for containerized deployment:

```yaml
# docker-compose.yml
services:
  aether:
    build: .
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock  # for sandbox execution
    environment:
      - PORT=3001
      - HOST=0.0.0.0
    restart: unless-stopped
```

```bash
# Build and start
docker compose up --build

# Run headless (backend only, no Electron)
docker compose up --build -d
```

The service starts on port 3001 with the health check endpoint at `/health`.

The Docker image includes:
- All 17 workspace packages compiled via `tsc -b`
- The backend API server as the entry point (`packages/aether-backend/dist/main.js`, reads `PORT`/`HOST`)
- `dumb-init` for proper signal handling

Not yet included (roadmap): persistent volume mounts, optional Docker socket mounting, a non-root runtime user.

---

## Testing

The project uses Vitest with **585 test cases across 40 test files**:

| Package | Tests | Coverage |
|---------|-------|----------|
| aether-utils | 140 | Async, IDs, logger, object, platform, string, validation |
| aether-providers | 58 | All 6 providers (chat, stream, embed, errors) |
| aether-backend | 53 | Router, server, store, websocket |
| aether-memory | 53 | Store, vector, RAG |
| aether-core | 46 | Event bus, lifecycle, config |
| aether-telemetry | 43 | Logger, tracer, metrics |
| aether-security | 38 | RBAC, roles, permissions |
| aether-sdk | 30 | Agent, model provider, tools |
| aether-orchestrator | 9 | Engine, builder, graph editor, visualizer |
| docker | ~18 | Container lifecycle, exec, resource profiles |
| ts-runtime | ~15 | VM execution, timeout, eval |
| python-venv | ~12 | Venv CRUD, package install |
| playwright | ~10 | Browser launch, navigation, eval |

---

## Development

```bash
# Install
npm install

# Build all packages
npm run build

# Type-check
npm run typecheck

# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format

# Headless backend (no Electron, API only)
npm run dev:backend
```
