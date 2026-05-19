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
       |        aether-providers    aether-memory                |
       |              ↕                  ↕                       |
       |        aether-tools  ─────  aether-sdk  ────────────────|
       |              ↕                                          |
       |        aether-utils (shared everywhere)                |
       |                                                         |
       └─────────── aether-telemetry ←─ aether-security ─────────┘
```

Higher-level packages (backend, frontend, electron) consume lower layers via workspace dependencies.

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
| **Container** | Docker (sandboxed execution), Dockerode |
| **Observability** | OpenTelemetry (OTLP), Pino structured logging |
| **Testing** | Vitest (470+ tests across 31 test files) |
| **CI/CD** | GitHub Actions, electron-builder |

---

## Quick Start

### Prerequisites

- Node.js 22+
- npm 10+

### One Command to Run

```bash
npm install
npm run start
```

This installs dependencies, builds all packages, and launches the Electron app.

### Individual Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Type-check
npm run typecheck

# Run tests (470+ tests, 31 test files)
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
- **Backend**: HTTP/WebSocket server (native, no framework), pattern-matched router, in-memory stores, CRUD routes, native WebSocket frame encoding/decoding
- **Electron Shell**: Main process with IPC handlers, tray, auto-updater (electron-updater), crash reporter, preload bridge
- **Docker Sandbox**: Container lifecycle (create/destroy), file copy, command execution with resource limits, profile-based presets
- **TypeScript Runtime Sandbox** (`@aether/ts-runtime`): Isolated VM execution via tsx child process, timeouts, output size limits, eval helper with JSON result parsing
- **Python Venv** (`@aether/python-venv`): Python virtual environment creation, package installation, script/code execution, package listing, full CRUD for venvs
- **Playwright Browser** (`@aether/playwright`): Browser automation wrapper — launch (chromium/firefox/webkit), navigation, screenshot, content extraction, page evaluation, interaction helpers
- **SDK**: AetherAgent wrapping OpenAI Agents SDK, AetherRunner with provider support, ToolRegistry, message conversion
- **CI/CD**: GitHub Actions (lint, type-check, test with sharding, build), electron-builder config (Windows/macOS/Linux)
- **Testing**: 470 tests across 31 test files, covering all packages

### 🚧 In Progress
- Electron renderer (React) — initial IPC bridge wired, DashboardPage uses real backend data (agents, providers, executions, system info)
- Frontend admin GUI pages — 7 scaffolded pages (Dashboard, Providers, Agents, Workflows, Memory, Executions, Plugins, Settings) with real data connections via IPC bridge

---

## Docker Deployment

```bash
docker compose up --build
```

The service starts on port 3001 with the health check endpoint at `/health`.

---

## License

MIT
