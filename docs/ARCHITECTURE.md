# Aether Architecture

**Version:** 0.2.0 · **Last Updated:** 2026-08-29

## Overview

Aether is a web-first autonomous AI orchestration platform. It embeds the **Oh My Pi** coding agent (a fork of Pi, MIT) via its Node SDK behind a compact TypeScript monorepo, and exposes the whole control plane — models, sessions, loops, skills, providers, agents, settings — through one HTTP/WebSocket API with a React GUI served from the same backend.

There is **no desktop shell and no separate services**: one backend process, one web UI, one Docker image.

## High-level topology

```
Browser (React + Vite, aether-frontend)
   │  same-origin HTTP (/,/api/*,/health)      ws://host:<port>/ (realtime)
   ▼
aether-backend (runs on Bun)
   ├── Router + AetherServer (node:http baseline, REST + legacy WS)
   ├── StaticFileServer  → hosts the built frontend (SPA fallback)
   ├── EngineService     → embedded @oh-my-pi/pi-coding-agent sessions
   ├── LoopManager/      → round→transition→round loop state machine
   │   LoopRunner
   ├── SkillsService     → SKILL.md discovery (.omp/skills, ~/.omp/agent/skills)
   └── BunRealtimeHub    → Bun.serve websocket hub for live engine events
        │
        └─ domain packages: aether-core · aether-memory · aether-orchestrator · aether-tools
```

### Why the runtime is Bun

The omp SDK (`@oh-my-pi/pi-coding-agent`) only runs under the **Bun** runtime (its native N-API addon and tooling assume Bun). Decisions that follow:

- The production backend (`packages/aether-backend/src/main.ts`) runs under `bun`.
- The REST surface keeps the battle-tested `node:http` server implementation (works under Bun and Node; the node vitest suite exercises it without the Bun-only SDK).
- Bun's `node:http` cannot host WebSockets (raw 101 writes on the upgrade socket never flush, and there is no `server.upgrade`), so live engine events flow through a **Bun-native `Bun.serve` hub** on `REALTIME_PORT` (advertised in `/health`). REST + realtime are two listeners in one process.
- The omp SDK is loaded **lazily** (dynamic `import()` inside `EngineService`), so the module graph stays plain-Node-safe and the node test suite never pulls in the Bun addon.

## Package layout

| Package               | Depends on                              | Responsibilities                                                                                                                                                                     |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aether-core`         | —                                       | Events (`EventBus`), lifecycle, config, shared types, utils, telemetry (pino + OpenTelemetry), security (RBAC). Merged from the former types/utils/core/telemetry/security packages. |
| `aether-memory`       | `aether-core`                           | `MemoryStore`, `InMemoryVectorStore`, `RAGEngine`, scoped stores (episodic/semantic/task/conversation).                                                                              |
| `aether-orchestrator` | `aether-core`                           | LangGraph workflow graph engine, `WorkflowBuilder`, checkpoint manager, graph editor + DOT/Mermaid visualizer.                                                                       |
| `aether-tools`        | `aether-core`                           | Tool registry, shell + Docker + Playwright + Python-venv + TS-runtime sandboxes (merged from tools/docker/playwright/python-venv/ts-runtime).                                        |
| `aether-backend`      | all above + `@oh-my-pi/pi-coding-agent` | HTTP/WS server, engine service, loop manager, skills service, model catalog, static GUI hosting.                                                                                     |
| `aether-frontend`     | `aether-core`                           | React + Vite web GUI.                                                                                                                                                                |

Dependency flow is strictly leaf → root: `core → memory/orchestrator/tools → backend → frontend`.

The former `aether-electron`, `aether-sdk`, and `aether-providers` packages are gone: the SDK/provider layer is superseded by the embedded omp engine and its model registry; the Electron shell by the web GUI.

## Backend internals

### Request path

1. `AetherServer` (node:http) handles `handleRequest`:
   - CORS preflight → 204.
   - Body-size cap → 413 before reading bytes.
   - Optional API-key auth (`Authorization: Bearer`/`X-API-Key`, constant-time compare) + RBAC for `/api/*`; `/health` stays open.
   - `Router.match` → route handler, or:
   - non-`/api/` GET → `StaticFileServer` (real file → stream; otherwise SPA fallback to `index.html`), else JSON 404.

### Engine (sessions / loops / skills / models)

- **`EngineService`** — owns the omp `ModelRegistry` + auth storage. `createSession()` resolves the model (a bare `{provider, modelId}` shape fails silently; the resolved `Model` object is required) and wraps an omp `AgentSession`. Session events are normalized to a small DTO set (`turn_start`, `message_update`, `message_end`, `tool_call`, `agent_end`, …) and pushed to the broadcast hook.
- **`LoopManager` / `LoopRunner`** — a loop is `[round N] → [transition] → [round N+1]`. The transition (configured per loop) is one of `none | compact | skill | gate`. Stop conditions: `maxRounds`, `maxTimeMs`, manual. A `gate` transition parks the loop until the GUI calls `/advance continue|stop`. The transition never runs after the final round. Loop events (`loop:start|round_start|round_end|transition|gated|stop|completed`) stream to the GUI.
- **`SkillsService`** — discovers `<root>/<name>/SKILL.md` packs (project `.omp/skills` first, then user `~/.omp/agent/skills`), parsing `name`/`description` frontmatter. A loop's `skill` transition reads the pack and runs its body as a session instruction.
- **Models** — `GET /api/models` maps the omp registry's `getAvailable()` into grouped records; both Session and Loop pickers consume it.

### Realtime

`BunRealtimeHub` is a `Bun.serve` websocket endpoint on `REALTIME_PORT`. Clients subscribe with `{ "filter": ["engine"] }` (mirrors the legacy WS manager contract). `broadcast()` fans engine frames to connected browsers; `/health` advertises `{ realtime: { port }, engine: { available } }`.

## Web GUI

`aether-frontend` is a Vite + React SPA (jsx, ES2022 target) with a sidebar over eight views: Dashboard, Sessions, Loops, Skills, Models, Providers, Agents, Settings. It talks to the backend through a typed `api.ts` client and a `RealtimeClient` that discovers the hub port from `/health`. The GUI is the only intended surface: every capability exposed by the API has a matching view.

## Security

- API key auth with constant-time digest comparison; RBAC (hierarchical roles + glob resources) enforced on `/api/agents|providers|executions|sessions|loops`.
- Static file serving rejects path traversal/absolute escapes; only GET/HEAD.
- Engine routes return 501 (not 500) when the engine is unavailable.

## Testing & verification

- **579 vitest tests** (`npm test`) across the six packages — run under Node, never importing the Bun-only omp SDK.
- `npm run build` = `tsc -b --force` (whole monorepo); `npm run lint` and `npm run format:check` gate CI.
- CI: lint/format/madge, type-check, tests, then a Docker image build (`package.yml`).

## Operation

- `docker compose up -d` → GUI at `http://localhost:3081`, realtime `ws://localhost:3082` (host ports remapped away from the common local 3001).
- Env: `PORT` (default 3001), `REALTIME_PORT` (3002), `HOST` (`0.0.0.0`), `MAX_BODY_SIZE`, `AETHER_API_KEY`.
- Model catalog: `~/.omp/agent/models.yml` + omp provider catalog; the GUI reads it live.

## Roadmap

- Persist loop definitions and session transcripts to disk.
- Per-round skill transition argument templating.
- GUI-driven provider CRUD into the engine registry.
- RBAC-scoped GUI access beyond admin.
