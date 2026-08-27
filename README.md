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
└── (electron-vite config lives in packages/aether-electron/electron.vite.config.ts)
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
| **Memory** | In-memory vector store (brute-force cosine); SQLite/Qdrant backends planned |
| **Container** | Docker (sandboxed execution), Dockerode |
| **Observability** | OpenTelemetry (OTLP), Pino structured logging |
| **Testing** | Vitest (585+ tests across 40 test files) |
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

# Run tests (585+ tests, 40 test files)
npm run test

# Launch Electron app (dev mode)
npm run dev

# Start the backend API server (tsx watch, live reload)
npm run dev:backend

# Start the built backend server (production entrypoint)
npm run start:backend
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
| `@aether/frontend` | Placeholder package — the React admin GUI lives in `aether-electron`'s renderer |
| `aether-electron` | Electron desktop shell + React admin GUI (renderer), tray, auto-updater, crash reporter |
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
- **Testing**: 585+ tests across 40 test files (14 packages; types/frontend/electron carry no test files yet)

### Latest Iteration — v0.1.1 Security & Cross-Platform Hardening

This iteration closed 10 evidence-backed defects found by three independent audit lenses (Windows cross-platform, async/reliability, security):

- **Windows support** — `ts-runtime` resolves the tsx entry via `fileURLToPath` + `process.execPath` (works on Windows, where `.cmd` shims cannot be `execFile`'d); `execShell` now quotes args correctly for `cmd.exe` (POSIX single-quotes are inert there) and uses `windowsVerbatimArguments`.
- **WebSocket hardening** — remote crash/OOM vectors removed: per-socket frame reassembly (fragmented and coalesced frames handled), strict length bounds before `Buffer.alloc`, masked-client-frame enforcement, control-frame ≤125 (RFC 6455 §5.5), bounded receive buffer, outbound write-backlog cap, and full socket teardown on protocol errors. Optional Origin allow-list wired from `setCorsOrigins`.
- **Request body limits** — unbounded body accumulation replaced with a 1 MB default (`AetherServerOptions.maxBodySize`), enforced for both `Content-Length` and chunked requests (413).
- **Conditional graph edges** — `gt/gte/lt/lte` operators in conditional workflow edges now actually evaluate (previously always `false`, so documented branches never fired).
- **RAG chunking** — `chunkFixed` can no longer infinite-loop on misconfigured overlap/size (config clamped + guaranteed forward progress).
- **Sandbox safety** — `copyFilesToSandbox` writes content via base64 (`printf %s '<b64>' | base64 -d > path`) and rejects path traversal; browser auto-install validates the browser name against an allow-list before running `npx playwright install`.
- **Server lifecycle** — `stop()` clears its force-close timer and uses `closeIdleConnections()` so in-flight requests are not aborted at shutdown.


### Latest Iteration — v0.1.2 Deployability, CI & Provider Wire Fixes

This iteration made Aether actually runnable and fixed wire-level provider bugs found by three fresh-scope scouts (Electron layer, SDK/providers/core, docs-vs-code/CI):

- **Production server entrypoint** — `packages/aether-backend/src/main.ts` reads `PORT`/`HOST`/`MAX_BODY_SIZE`, starts the HTTP/WebSocket server, and shuts down gracefully on SIGINT/SIGTERM. `npm run start:backend` runs it; Docker now boots a real server (previously the barrel export exited immediately).
- **Electron IPC bridge wired** — the backend-bridge IPC handlers (`agents:*`, `providers:*`, `executions:*`, `plugins:*`, `memory:*`) were dead code (never imported); now registered in `app.whenReady`. The renderer's `window.electronAPI` calls no longer reject with "No handler registered".
- **Quit fixed** — `app.isQuitting` is now set in `before-quit`; previously `app.quit()` was swallowed (window only hid to tray, process could not exit).
- **CI repaired** — lint dependency `typescript-eslint` declared (lint previously crashed with `ERR_MODULE_NOT_FOUND`; now 0 errors after clearing 25 pre-existing ones + 19 renderer-page dead imports), `tsc -b --noEmit` replaced with `npm run typecheck` (the former fails TS6310 on fresh checkouts), a real coverage job added, and the circular-dep check wired to actually inspect files (`madge` pinned, globstar expansion).
- **Docker build fixed** — `package-lock.json` no longer excluded from the build context; all 17 workspace manifests copied before `npm ci`; `CMD` points at the production entrypoint.
- **Electron packaging fixed** — `electron-vite build` added before `electron-builder` in package/release jobs (installers previously shipped empty — `out/` was never produced); `electron-builder` is now a declared devDependency; release workflow migrated from deprecated `create-release@v1` to `gh release`.
- **Provider wire fixes** — Gemini streaming URL no longer builds `?alt=sse?key=…` (double `?` — the API key was never sent, so authenticated streaming 403'd); `toolChoice: required` is mapped to the valid wire value `required` (was `any`); `getRetryAdvice` now honours the SDK's `{ suggested }` contract and never retries permanent errors; `ProviderRegistry.get()` shares one in-flight initialization and clears a provider whose `initialize()` failed.
- **Docs made truthful** — README/ARCHITECTURE: dev-command semantics, SQLite/Qdrant backends marked planned (not implemented), `@aether/frontend` labeled a placeholder, test counts corrected.


### Latest Iteration — v0.1.3 Tool-Loop Wire Fix

Sequential multi-turn tool use now works on every provider. Previously the SDK converted assistant tool calls to a text placeholder (`[tool_call: name]`) and tool results to a `{role: 'tool'}` message **without `tool_call_id`** — OpenAI-compatible endpoints reject that with a 400, and Anthropic/Gemini lost the correlation id too, so every tool-using agent failed on its second model call.

- `aether-providers` `Message` gained `toolCalls`/`toolCallId`; only the SDK's converter populates them (verified: the installed `@openai/agents` `FunctionCallItem`/`FunctionCallResultItem` use camelCase `callId`/`arguments`, matching the conversion — pinned at compile time by a test typed against the real SDK items).
- **OpenAI-family** (OpenAI-compatible, vLLM, OpenRouter, Ollama, llama.cpp): assistant tool calls serialize as structured `tool_calls` (`{id, type: 'function', function: {name, arguments}}`), results carry `tool_call_id`.
- **Anthropic**: `tool_use` blocks (+ companion text) and `tool_result` with `tool_use_id` in a user turn.
- **Gemini**: `functionCall` / `functionResponse` parts (Gemini rejects bare text "function" parts).
- New discriminating wire tests per provider family (OpenAI-compatible, Anthropic, Gemini) plus an SDK-level test exercising the real SDK item types.

Verification: **590 tests passing (was 585) across 40 files, `tsc -b` clean, lint + format checks green**, and a dual-adversarial review loop including an independent settlement of the SDK item-schema question against the installed dependency.

---

## Roadmap

Next iterations target the remaining control-plane and correctness work:

- **Streaming tool calls** — accumulate tool-call fragments and final text in `completeStream` so **streamed** tool runs work across all providers (the final `done` event currently drops accumulated tool calls/text). Sequential tool loops were fixed in v0.1.3 (`tool_call_id` now threaded through every provider's serializer).
- **Credential storage** — the vault's AES-256-GCM fallback is unreachable dead code (the keytar-less branch loads the plaintext JSON store and reports `usingKeychain: true`); make the encrypted-file store reachable with 0600 perms, and stop persisting raw provider API keys in the renderer settings store.
- **Authentication & authorization** — the HTTP/WebSocket API is unauthenticated on `0.0.0.0:3001`; wire the existing `aether-security` RBAC into routes and add per-session auth.
- **Electron update surface** — auto-updater never emits renderer events and `update:check`/`update:install` are unregistered; wire the event stream.
- **Reliability parity** — memory-store `defaultTtlMs` at write time, per-subscriber event-bus isolation, Gemini batch embeddings.

---

## Docker Deployment

```bash
docker compose up --build
```

The service starts on port 3001 with the health check endpoint at `/health`.

---

## License

MIT
