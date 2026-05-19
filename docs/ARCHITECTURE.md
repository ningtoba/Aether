# Aether Architecture

**Version:** 0.1.0  
**Last Updated:** 2026-05-19

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
│  │  │  Docker sandbox  │  │  Pino logging + metrics  │    │  │
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
│  │  Tabbed: Agents, Providers, Orchestration,     │           │
│  │  Workflow, Memory, Execution, Settings         │           │
│  └───────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌──────────────┐  ┌─────────────────┐
│  aether-sdk          │  │ Execution    │  │ Plugin System   │
│  AetherAgent wrapping│  │ Sandboxes    │  │ Hot-loadable    │
│  OpenAI Agents SDK   │  │ Docker, WASM,│  │ tool/provider   │
│                      │  │ Python venv  │  │ hooks/middleware │
└─────────────────────┘  └──────────────┘  └─────────────────┘
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
- Docker container sandbox (create/destroy/exec via CLI)
- Resource profiles: minimal/standard/high/unrestricted
- File copy, environment injection, timeout handling

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
- AetherAgent wrapping OpenAI Agents SDK Agent
- AetherRunner with AetherModelProvider bridging
- ToolRegistry and createTool helper
- Handoff support between agents

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

### `@aether/frontend` — Shared UI Components
- React 19 components (Electron renderer)
- Zustand with persist middleware for settings store
- 13 settings categories: general, providers, orchestration, memory, execution, docker, security, browser, logging, plugins, deployment, evaluation, GUI

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

1. **API Layer** receives agent execution request (`POST /api/execute`)
2. **Orchestrator** resolves orchestration mode from workflow definition and agent configs
3. **Provider** makes LLM calls with configured model (chat, stream, or embeddings)
4. **Tool Execution** runs any tool calls the LLM generates (Docker sandbox or local)
5. **Memory** retrieves relevant context via hybrid search before each step, stores results
6. **Telemetry** records everything as structured spans and metrics
7. **Response** streams back via WebSocket or returns as complete payload

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

- **Sandboxed execution** — Tools run in Docker containers with resource limits
- **API authentication** — All endpoints require API key or JWT
- **Provider key isolation** — LLM API keys stored in encrypted vault, never leaked to sandboxes
- **Path allow-listing** — File system tools only access explicitly allowed paths
- **Rate limiting** — Per-API-key request throttling
- **RBAC** — Role-based access control with 5 built-in roles

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

## Testing

The project uses Vitest with 306 test cases across 20 test files:

| Package | Tests | Coverage |
|---------|-------|----------|
| aether-core | 45 | Event bus, lifecycle, config |
| aether-utils | 95 | Async, IDs, logger, object, platform, string, validation |
| aether-memory | 61 | Store, vector, RAG |
| aether-providers | 54 | All 6 providers (chat, stream, embed, errors) |
| aether-orchestrator | 6 | Engine, builder, graph editor, visualizer |

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
```
