# Aether

> Autonomous AI orchestration platform — build, manage, and run multi-agent workflows at scale.

Aether is a full-stack platform for orchestrating autonomous AI agents. It provides a modular monorepo with provider abstraction, memory systems, workflow orchestration, sandboxed execution, and a React-based admin GUI — all wrapped in an Electron desktop application.

---

## Architecture

Aether is organized into 10 architectural layers, each in its own workspace package:

```
aether/
├── packages/
│   ├── aether-types/         # Core type definitions and interfaces
│   ├── aether-core/          # Core runtime, event bus, lifecycle, config management
│   ├── aether-providers/     # LLM provider abstraction (OpenAI, Anthropic, Ollama, etc.)
│   ├── aether-orchestrator/  # Orchestration engine (sequential, parallel, DAG, debate, hierarchical)
│   ├── aether-memory/        # Memory backend abstraction (vector stores, embeddings, RAG)
│   ├── aether-tools/         # Built-in tool definitions, shell executor, event bus
│   ├── aether-sdk/           # Public SDK for building plugins and integrations
│   ├── aether-utils/         # Shared utilities (async, config, validation, platform detection)
│   ├── aether-telemetry/     # Logging, metrics, distributed tracing
│   ├── aether-security/      # RBAC, authentication, authorization
│   ├── aether-backend/       # HTTP API server with REST API & WebSocket streaming
│   ├── aether-frontend/      # React-based admin GUI
│   ├── aether-electron/      # Electron desktop shell with tray, auto-updater, crash reporter
│   └── docker/               # Docker sandbox for isolated code execution
├── Dockerfile                # Multi-stage production Docker build
├── docker-compose.yml        # Docker Compose for local deployment
├── tsconfig.json             # Root TypeScript configuration
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
| **Runtime** | Node.js 25, Bun 1.3 |
| **Language** | TypeScript 5.8 (strict mode) |
| **Build** | tsc (project references), Vite |
| **Desktop** | Electron 35 |
| **Backend** | Node.js http module (no framework), WebSocket |
| **Frontend** | React 19, TailwindCSS |
| **Orchestration** | LangGraph-compatible DAG engine |
| **Container** | Docker (sandboxed execution) |
| **CI/CD** | GitHub Actions, electron-builder |

---

## Quick Start

### Prerequisites

- **Node.js** >= 22
- **Bun** >= 1.3 (for package management)
- **TypeScript** >= 5.8

### Install

```bash
git clone https://github.com/your-org/aether.git
cd aether
bun install
```

### Build All Packages

```bash
bun run build
```

Or build individual packages:

```bash
bun run build -w @aether/types
bun run build -w @aether/core
# etc.
```

### Development

```bash
# Type-check all packages
bun run typecheck

# Run tests
bun run test

# Lint
bun run lint
```

### Start Services

```bash
# Start the backend API server
bun run dev:backend

# Start the frontend dev server (separate terminal)
bun run dev:frontend

# Start the Electron app
bun run dev:electron
```

The API server runs on `http://localhost:3001` with health check at `/health`.

---

## Package Quick Reference

| Package | Description |
|---------|-------------|
| `@aether/types` | Shared TypeScript type definitions (providers, agents, execution, memory, tools) |
| `@aether/core` | Core runtime, event bus (EventEmitter), lifecycle manager, configuration manager |
| `@aether/providers` | LLM provider abstraction with registry, vault, model capabilities |
| `@aether/orchestrator` | Orchestration engine (sequential, parallel, DAG, debate, hierarchical) |
| `@aether/memory` | Pluggable memory backends (vector store, RAG, embedding configuration) |
| `@aether/tools` | Built-in tools, shell executor, tool registry, event bus |
| `@aether/sdk` | Public SDK for building plugins and integrations |
| `@aether/utils` | Shared utilities: async helpers, config, validation, platform detection |
| `@aether/telemetry` | Structured logging, metrics collection, distributed tracing |
| `@aether/security` | Role-based access control (RBAC) |
| `@aether/backend` | HTTP/WebSocket server with REST API for agent, provider, and execution management |
| `@aether/frontend` | React-based admin GUI |
| `aether-electron` | Electron desktop shell with tray, auto-updater, crash reporter |

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

## Docker Deployment

```bash
docker compose up --build
```

The service starts on port 3001 with the health check endpoint at `/health`.

---

## Project Status

Aether is in early development (v0.1.0). The scaffold is in place with package structure, build system, and CI/CD configured. Core implementations are being actively developed.

---

## License

MIT
