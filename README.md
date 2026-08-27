# Aether

> Autonomous AI orchestration platform — build, manage, and run multi-agent workflows at scale.

Aether is a full-stack platform for orchestrating autonomous AI agents. It provides a modular monorepo with provider abstraction, memory systems, workflow orchestration, sandboxed execution, and a React-based admin GUI — all wrapped in an Electron desktop application.

---

## Architecture

Aether is organized into 17 npm workspace packages:

```
aether/
├── packages/
│   ├── aether-types/         # Core type definitions and interfaces
│   ├── aether-core/          # Core runtime, event bus, lifecycle, config management
│   ├── aether-providers/     # LLM provider abstraction (Anthropic, Gemini, Ollama, etc.)
│   ├── aether-orchestrator/  # Orchestration engine (DAG, sequential, parallel, map-reduce)
│   ├── aether-memory/        # Memory backend abstraction (vector stores, embeddings, RAG)
│   ├── aether-tools/         # Built-in tool definitions, shell executor, tool registry
│   ├── aether-sdk/           # Public SDK for building plugins and integrations
│   ├── aether-utils/         # Shared utilities (async, config, validation, platform detection)
│   ├── aether-telemetry/     # Logging, metrics, distributed tracing (OpenTelemetry)
│   ├── aether-security/      # RBAC, authentication, authorization
│   ├── aether-backend/       # HTTP API server with REST API & WebSocket streaming
│   ├── aether-frontend/      # React-based admin GUI (Electron renderer)
│   ├── aether-electron/      # Electron desktop shell with tray, auto-updater, crash reporter
│   ├── docker/               # Docker sandbox for isolated code execution
│   ├── ts-runtime/           # TypeScript runtime sandbox (isolated VM via tsx)
│   ├── python-venv/          # Python virtual environment management
│   └── playwright/           # Playwright browser automation
├── tsconfig.json             # Root TypeScript configuration (project references)
└── electron.vite.config.ts   # Electron-vite build configuration
```

### Package Dependency Flow

```
aether-types  →  aether-core  →  aether-orchestrator  →  aether-backend
       ↑              ↕                  ↕                       ↑
       |        aether-providers    aether-memory                 |
       |              ↕                  ↕                        |
       |        aether-tools  ─────  aether-sdk  ─────────────────|
       |              ↕                                           |
       |        aether-utils (shared everywhere)                  |
       |                                                          |
       └──── aether-telemetry ←── aether-security ────────────────┘
```

Dependency relationships:

- `aether-types` is the leaf — no dependencies
- `aether-utils` is shared everywhere (no deps on other workspace packages)
- `aether-telemetry` depends on `aether-types` and `aether-utils`
- `aether-security` depends on `aether-types` and `aether-utils`
- `aether-core` depends on `aether-types`, `aether-utils`, `aether-telemetry`
- `aether-providers` depends on `aether-types`, `aether-utils`, `aether-telemetry`, `aether-core`
- `aether-memory` depends on `aether-types`, `aether-utils`
- `aether-tools` depends on `aether-types`, `aether-utils`
- `aether-sdk` depends on `aether-types`, `aether-utils`, `aether-providers`, `aether-tools`
- `aether-orchestrator` depends on `aether-types`, `aether-utils`, `aether-core`, `aether-providers`, `aether-memory`
- `aether-backend` depends on all lower layers
- `aether-frontend` depends on `aether-types`
- `aether-electron` depends on `aether-backend` and `aether-frontend`
- Sandbox packages (`docker`, `ts-runtime`, `python-venv`, `playwright`) depend on `aether-types` and `aether-utils`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 22+ |
| **Language** | TypeScript 5.9 (strict mode) |
| **Build** | tsc (project references), electron-vite |
| **Desktop** | Electron 35 |
| **Backend** | Node.js http module (no framework), WebSocket |
| **Frontend** | React 19, TailwindCSS 4, Framer Motion, Zustand |
| **Orchestration** | LangGraph-compatible DAG engine (LangGraph v1) |
| **LLM Providers** | Anthropic, Gemini, Ollama, vLLM, llama.cpp, OpenRouter, OpenAI-compatible |
| **Memory** | In-memory vector store (brute-force cosine), SQLite, Qdrant |
| **Container** | Docker (sandboxed execution), Dockerode || **Observability** | OpenTelemetry (OTLP), Pino structured logging |
|| **Testing** | Vitest (580+ tests across 39 test files) |
| **CI/CD** | GitHub Actions, electron-builder |

---

## Quick Start

### Prerequisites

- Node.js 22+
- npm 10+

### One Command to Run

```bash
npm install
npm run dev:electron
```

This installs dependencies, builds all packages, and launches the Electron app.

> **Note:** For reproducible installs, a `.npmrc` with `engine-strict=true` and `save-exact=true` is recommended.

### Individual Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Type-check
npm run typecheck

# Run tests (580+ tests, 39 test files)
npm run test

# Launch Electron app (dev mode)
npm run dev

# Start backend API server only
npm run dev:backend
```

The API server runs on `http://localhost:3001` with health check at `/health`.

---

## Package Quick Reference

| Package | Description |
|---------|-------------|
| `@aether/types` | Shared TypeScript type definitions (providers, agents, execution, memory, tools) |
| `@aether/core` | Core runtime, event bus (typed EventEmitter), lifecycle manager, configuration manager |
| `@aether/providers` | LLM provider abstraction with registry, vault (encrypted keychain), model capabilities |
| `@aether/orchestrator` | Orchestration engine with WorkflowBuilder (DAG), LangGraph wrapper, Mermaid/DOT visualization |
| `@aether/memory` | Pluggable memory backends (in-memory vector store, RAG with hybrid search, memory store) |
| `@aether/tools` | Built-in tools, shell executor, tool registry |
| `@aether/sdk` | Public SDK wrapping OpenAI Agents SDK (AetherAgent, AetherRunner, ToolRegistry) |
| `@aether/utils` | Shared utilities: async helpers (retry, backoff, parallel), validation, string, object, platform detection |
| `@aether/telemetry` | OpenTelemetry tracing (OTLP exporter), Pino structured logging, metrics collection (counters/gauges/histograms) |
| `@aether/security` | Role-based access control (RBAC) with hierarchical roles, glob-based resource patterns |
| `@aether/backend` | HTTP/WebSocket server with REST API for agent, provider, and execution management |
| `@aether/frontend` | React-based admin GUI (Electron renderer) |
| `aether-electron` | Electron desktop shell with tray, auto-updater, crash reporter |
| `@aether/docker` | Docker sandbox container lifecycle, resource profiles, file injection |
| `@aether/ts-runtime` | TypeScript runtime sandbox — isolated VM execution via tsx with timeouts and resource limits |
| `@aether/python-venv` | Python virtual environment management — create, install packages, run scripts |
| `@aether/playwright` | Browser automation — launch, navigate, screenshot, evaluate, interact |

---

## API Endpoints (Backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | System health check (version, uptime, memory) |
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create a new agent |
| `GET` | `/api/agents/:id` | Get agent by ID |
| `PUT` | `/api/agents/:id` | Update agent |
| `DELETE` | `/api/agents/:id` | Delete agent |
| `GET` | `/api/providers` | List configured providers |
| `POST` | `/api/providers` | Add/configure a provider |
| `GET` | `/api/providers/:id/health` | Check provider health |
| `DELETE` | `/api/providers/:id` | Remove a provider |
| `GET` | `/api/executions` | List executions |
| `POST` | `/api/executions` | Start a new execution |
| `GET` | `/api/executions/:id` | Get execution status |
| `POST` | `/api/executions/:id/cancel` | Cancel an execution |

WebSocket endpoint is available at `ws://localhost:3001/` (upgraded from the HTTP server).

---

## Project Status

Aether is v0.1.0 with the following implemented:

### ✅ Complete
- **Type System**: All type definitions across 9 domains (providers, agents, execution, graph, memory, tools, settings, sandbox, base)
- **Core Runtime**: Event bus (typed pub/sub with async/retry modes), lifecycle manager (5-stage state machine), config manager
- **Utilities**: Async helpers (retry with exponential/linear/fixed backoff, parallel with concurrency, timeout), validation, string manipulation, object deep merge/clone, ID generation, platform detection, structured logger
- **LLM Providers**: Anthropic, Gemini, Ollama, vLLM, llama.cpp, OpenRouter, OpenAI-compatible — all with chat, streaming, embeddings, model listing, and error handling
- **Orchestration**: LangGraph engine, workflow builder (fluent API with agent/router/map/reduce nodes), checkpoint manager, graph editor, visualizer (Mermaid, DOT, text tree)
- **Memory**: In-memory vector store (cosine similarity), memory store (TTL, keyword search), RAG engine (hybrid retrieval, 3 chunking strategies)
- **Security**: RBAC with 5 built-in roles (admin, operator, developer, agent, viewer), hierarchical inheritance, glob resource matching
- **Telemetry**: Pino structured logging with OTel trace context injection, OpenTelemetry tracing (console + OTLP exporters), metrics (counters, gauges, histograms with percentile support)
- **Backend**: HTTP/WebSocket server (native, no framework), pattern-matched router, in-memory stores, CRUD routes, hardened native WebSocket (RFC 6455 frame reassembly, masked-frame enforcement, 1 MB frame/payload and per-socket memory bounds, outbound backlog cap, full teardown on protocol errors, Origin allow-list), request body size limit (1 MB default, per-server `maxBodySize` incl. chunked bodies)
- **Electron Shell**: Main process with IPC handlers, tray, auto-updater (electron-updater), crash reporter, preload bridge
- **Electron IPC Bridge**: Typed protocol with 12 channel groups (app, system, backend, agents, providers, executions, plugins, memory, window, update, maximize-changed), contextBridge preload API, `backend-bridge.ts` in-memory stores mirroring all REST API routes
- **Frontend (React GUI)**: 8 complete pages — Dashboard, Providers, Agents, Workflows, Memory, Executions, Plugins, Settings — all connected to real data via IPC bridge (window.electronAPI). Zustand store with persist middleware for settings. Custom title bar with window controls. Sidebar navigation with active state. Components include: SettingsSection/SettingsRow, toggle switches, dropdown selects, text inputs, sliders, tag groups, key-value editors, buttons with danger/primary variants
- **Docker Sandbox**: Container lifecycle (create/destroy), file copy, command execution with resource limits, profile-based presets
- **TypeScript Runtime Sandbox** (`@aether/ts-runtime`): Isolated VM execution via tsx child process, timeouts, output size limits, eval helper with JSON result parsing
- **Python Venv** (`@aether/python-venv`): Python virtual environment creation, package installation, script/code execution, package listing, full CRUD for venvs
- **Playwright Browser** (`@aether/playwright`): Browser automation wrapper — launch (chromium/firefox/webkit), navigation, screenshot, content extraction, page evaluation, interaction helpers
- **SDK**: AetherAgent wrapping OpenAI Agents SDK, AetherRunner with provider support, ToolRegistry, message conversion
- **Docker Deployment**: Dockerfile + docker-compose.yml for containerized operation via `docker compose up --build`
- **CI/CD**: GitHub Actions (lint, type-check, test with sharding, build), electron-builder config (Windows/macOS/Linux)
- **Testing**: 580+ tests across 39 test files, covering all 17 packages

### Latest Iteration — v0.1.1 Security & Cross-Platform Hardening

This iteration closed 10 evidence-backed defects found by three independent audit lenses (Windows cross-platform, async/reliability, security):

- **Windows support** — `ts-runtime` resolves the tsx entry via `fileURLToPath` + `process.execPath` (works on Windows, where `.cmd` shims cannot be `execFile`'d); `execShell` now quotes args correctly for `cmd.exe` (POSIX single-quotes are inert there) and uses `windowsVerbatimArguments`.
- **WebSocket hardening** — remote crash/OOM vectors removed: per-socket frame reassembly (fragmented and coalesced frames handled), strict length bounds before `Buffer.alloc`, masked-client-frame enforcement, control-frame ≤125 (RFC 6455 §5.5), bounded receive buffer, outbound write-backlog cap, and full socket teardown on protocol errors. Optional Origin allow-list wired from `setCorsOrigins`.
- **Request body limits** — unbounded body accumulation replaced with a 1 MB default (`AetherServerOptions.maxBodySize`), enforced for both `Content-Length` and chunked requests (413).
- **Conditional graph edges** — `gt/gte/lt/lte` operators in conditional workflow edges now actually evaluate (previously always `false`, so documented branches never fired).
- **RAG chunking** — `chunkFixed` can no longer infinite-loop on misconfigured overlap/size (config clamped + guaranteed forward progress).
- **Sandbox safety** — `copyFilesToSandbox` writes content via base64 (`printf %s '<b64>' | base64 -d > path`) and rejects path traversal; browser auto-install validates the browser name against an allow-list before running `npx playwright install`.
- **Server lifecycle** — `stop()` clears its force-close timer and uses `closeIdleConnections()` so in-flight requests are not aborted at shutdown.

Verification: **581 tests passing (was 548) across 39 files, `tsc -b` clean**, plus a dual-adversarial review loop (security + correctness reviewers, two rounds) before commit.

---

## Roadmap

Next iterations target production hardening of the control plane:

- **Authentication & authorization** — the HTTP/WebSocket API is currently unauthenticated on `0.0.0.0:3001`; wire the existing `aether-security` RBAC into backend routes and add per-session auth (API keys/tokens).
- **Credential storage** — replace the plaintext JSON keychain fallback with the encrypted-file vault (currently dead code) and 0600 permissions; stop persisting raw provider API keys in the renderer (`localStorage`).
- **WebSocket lifecycle** — aggregate connection-count cap and an idle/partial-frame reaper to bound FD usage by many half-open peers.
- **Reliability parity** — apply memory-store `defaultTtlMs` at write time, isolate event-bus subscriber failures (per-handler try/catch), and fix stale execution state when a `threadId` is reused.
- **Cross-platform CI** — add a Windows runner job to exercise the Windows-specific paths (tsx entry, cmd.exe escaping) on every push.

---

## Docker Deployment

```bash
docker compose up --build
```

The service starts on port 3001 with the health check endpoint at `/health`.

---

## License

MIT
