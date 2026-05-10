# Aether Architecture

**Version:** 0.1.0  
**Last Updated:** 2026-05-10

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
│  │   HTTP Server (Express/Fastify)                        │  │
│  │   REST API + WebSocket for exec logs                   │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-core     │  │  aether-orchestrator     │    │  │
│  │  │  Runtime base    │  │  LangGraph/Agents SDK    │    │  │
│  │  │  Plugin loader   │  │  Sequential, parallel,   │    │  │
│  │  │  Config manager  │  │  workflow, debate modes  │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-providers│  │  aether-memory           │    │  │
│  │  │  LLM provider    │  │  Vector store, SQLite    │    │  │
│  │  │  abstraction     │  │  filesystem watch, RAG   │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-tools    │  │  aether-telemetry        │    │  │
│  │  │  Sandbox exec,   │  │  OpenTelemetry, Pino     │    │  │
│  │  │  Docker, Browser │  │  logging, tracing        │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌─────────────────────────┐    │  │
│  │  │  aether-types    │  │  aether-utils            │    │  │
│  │  │  Shared types    │  │  Helpers, validators     │    │  │
│  │  └──────────────────┘  └─────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────┐           │
│  │          aether-frontend / admin-gui           │           │
│  │  Svelte 5 web app (Vite) or Electron renderer │           │
│  │  Tabs: Agents, Providers, Orchestration,       │           │
│  │  Workflow, Memory, Execution, Plugins          │           │
│  └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌──────────────┐  ┌─────────────────┐
│  aether-sdk          │  │ Execution    │  │ Plugin System   │
│  Public API for      │  │ Sandboxes    │  │ Hot-loadable    │
│  external apps       │  │ Docker, WASM,│  │ tool/provider   │
│                      │  │ Python venv  │  │ hooks/middleware │
└─────────────────────┘  └──────────────┘  └─────────────────┘
```

---

## Package Map

### `@aether/core` — Runtime Foundation
- Plugin loader and hot-reload system
- Configuration manager (file/env/CLI)
- Lifecycle hooks (init, start, stop, health)
- Shared event bus

### `@aether/providers` — LLM Provider Abstraction
- Provider registry with pluggable backends
- Built-in: OpenAI-compatible, Anthropic, Ollama, vLLM
- Unified interface: `chat()`, `embed()`, `stream()`
- Model discovery, fallback routing, rate limiting

### `@aether/orchestrator` — Multi-Agent Workflows
- Orchestration modes:
  - **Sequential** — agents run one after another, output pipes to next
  - **Parallel** — agents run concurrently, results merged
  - **Workflow (DAG)** — directed graph with router/condition/merge nodes
  - **Debate** — agents critique each other's outputs
  - **Hierarchical** — supervisor delegates to sub-agents
- LangGraph integration for stateful graphs
- OpenAI Agents SDK integration for dynamic delegation
- Execution state machine: queued -> running -> paused -> completed|failed

### `@aether/memory` — Memory & Knowledge
- SQLite via `better-sqlite3` for persistent state
- Vector embeddings via `@xenova/transformers` (local, no API key)
- Configurable backends: pgvector, ChromaDB, Qdrant, Pinecone
- Filesystem watcher for auto-ingestion (`chokidar`)
- RAG pipeline: chunk -> embed -> store -> retrieve
- Top-K semantic search with configurable dimensions

### `@aether/tools` — Tool Execution Sandbox
- Docker container sandbox for safe code execution
- Playwright browser automation
- TypeScript runtime sandbox (isolated VM)
- Python virtual environment management
- File system access with path allow-listing
- HTTP/web tool belt (fetch, scrape, search)

### `@aether/telemetry` — Observability
- OpenTelemetry tracing (OTLP exporter)
- Pino structured logging
- Health check endpoints
- Metrics collection (request count, latency, error rate)
- Execution audit trail

### `@aether/types` — Shared Type Definitions
- `LLMProvider` — provider connection config
- `MemoryConfig` — vector store / embedding settings
- `AgentConfig` — full agent definition (prompt, model, tools)
- `WorkflowConfig` — DAG of nodes and edges
- `OrchestrationConfig` — multi-agent orchestration plan
- `Execution` — run state, logs, timestamps
- `Plugin` — hot-loadable extension descriptor
- `ToolConfig` — tool binding with typed parameters

### `@aether/utils` — Utilities
- Cryptography (key generation, hashing)
- Date/time formatting
- Object deep merge / clone
- Retry with backoff
- Rate limiter (token bucket)
- JSON schema validation

### `@aether/sdk` — Public API for External Consumers
- Programmatic agent creation and execution
- Webhook registration for async callbacks
- Client library for other services
- API key authentication helpers

### `@aether/backend` — HTTP Server
- REST API endpoints for all CRUD operations
- WebSocket for real-time execution logs
- Authentication middleware (API key / JWT)
- Rate limiting
- Static file serving for admin UI

### `@aether/frontend` — Shared UI Components
- Svelte 5 components used by both admin-gui and electron renderer
- Shared stores, styling, and utilities
- Dark theme design system

### `@aether/electron` — Desktop Shell
- Electron main process
- Auto-updater with `electron-updater`
- Native OS integration (tray, notifications)
- Window management

### `@aether/admin-gui` — Admin Web Interface
- Svelte 5 SPA with Vite
- Tabbed layout: Agents, Providers, Orchestration, Workflow, Memory, Execution, Plugins
- Proxies `/api` to backend in dev mode

---

## Data Flow

```
User Input
    │
    ▼
aether-backend (REST / WS)
    │
    ▼
aether-orchestrator
    │
    ├─► aether-core (plugin lifecycle, config)
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

1. **API Layer** receives agent execution request (`POST /api/execute`)
2. **Orchestrator** resolves orchestration mode and agent configs
3. **Provider** makes LLM calls with configured model
4. **Tool Execution** runs any tool calls the LLM generates
5. **Memory** retrieves relevant context before each step, stores results
6. **Telemetry** records everything as structured spans
7. **Response** streams back via WebSocket or returns as complete payload

---

## Configuration

Aether reads configuration from (in order of precedence):
1. CLI flags
2. Environment variables (`AETHER_*`)
3. Config file (`aether.config.json` or `aether.config.yaml`)
4. Defaults

Key configuration domains:
- `providers` — LLM provider definitions
- `agents` — agent definitions
- `orchestration` — orchestration plans
- `memory` — storage backend config
- `tools` — sandbox and tool config
- `server` — HTTP server settings
- `logging` — telemetry and log level

---

## Security Model

- **Sandboxed execution** — Tools run in Docker containers or isolated VMs
- **API authentication** — All endpoints require API key or JWT
- **Provider key isolation** — LLM API keys stored in config, never leaked to sandboxes
- **Path allow-listing** — File system tools only access explicitly allowed paths
- **Rate limiting** — Per-API-key request throttling

---

## Extension Points

### Plugins
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
