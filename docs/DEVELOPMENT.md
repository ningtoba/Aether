# Aether Development Guide

Setup, build, run, and extend Aether locally.

---

## Prerequisites

- **Bun ≥ 1.3.14** — required at runtime: the embedded agent engine (`@oh-my-pi/pi-coding-agent`) only runs under Bun.
- **Node 22+** — used by tooling and the vitest suite (tests run under Node; they never import the Bun-only SDK).
- Optional: Docker + Docker Compose for the containerized run.

## Install & build

```bash
npm install
npm run build            # tsc -b --force over the 6 packages
npm run build:frontend   # vite build -> packages/aether-frontend/dist
```

## Run the backend

```bash
bun run packages/aether-backend/src/main.ts
# → http://localhost:3001  (GUI + API)  ·  ws://localhost:3002 (realtime)
```

Environment variables:

| Variable         | Default   | Purpose                                              |
| ---------------- | --------- | ---------------------------------------------------- |
| `PORT`           | `3001`    | REST API + web GUI port                              |
| `REALTIME_PORT`  | `3002`    | Bun-native WebSocket hub for live engine events      |
| `HOST`           | `0.0.0.0` | Bind address                                         |
| `MAX_BODY_SIZE`  | `1000000` | Request body cap (bytes)                             |
| `AETHER_API_KEY` | —         | When set, requires this key (admin role) on `/api/*` |

> Local tip: if port `3001` is taken (e.g. by the Hermes MCP gateway), run
> `PORT=3101 REALTIME_PORT=4101 bun run packages/aether-backend/src/main.ts`.

## Frontend dev server

```bash
npm run dev:frontend     # vite at :5173, proxies /api + /health to backend :3001
```

In production the backend serves the compiled frontend from `packages/aether-frontend/dist` (see [Architecture](ARCHITECTURE.md#web-gui)).

## Tests & checks

```bash
npm test                 # 582 vitest tests across the 6 packages
npm run test:e2e         # e2e tests (backend integration, WS frames)
npm run build            # full monorepo typecheck
npm run lint             # eslint (0 errors)
npm run format:check     # prettier
```

Tests run under Node and must never import `@oh-my-pi/pi-coding-agent` — the engine is loaded lazily behind `EngineService` so the node suite stays clean.

## Adding a model

The engine's model catalog comes from the omp registry. Custom providers/models live in `~/.omp/agent/models.yml` (see omp's provider docs), e.g.:

```yaml
providers:
  spark:
    baseUrl: http://127.0.0.1:8000/v1
    api: openai-completions
    models:
      - id: my-model
        name: My Model
```

The **Models** page and both Session/Loop model pickers read this catalog live via `GET /api/models`.

## Working on the engine

- `packages/aether-backend/src/engine/engine-service.ts` — `EngineService`: owns the omp `ModelRegistry` + auth storage, creates/wraps `AgentSession`s.
- `loop-runner.ts` — `LoopRunner`: the `[round] → [transition] → [round]` state machine (`none | compact | skill | gate`).
- `loop-manager.ts` — `LoopManager`: persists loop definitions, dispatches start/stop/advance.
- `skills.ts` — `SkillsService`: discovers `SKILL.md` packs.
- `realtime/bun-realtime.ts` — `BunRealtimeHub`: the `Bun.serve` WebSocket hub that streams engine events to the GUI.

Two invariants keep the runtime split working:

1. The omp SDK is imported **dynamically** (`await import('@oh-my-pi/pi-coding-agent')`) and only on the Bun path.
2. REST stays on the `node:http` `AetherServer` (works under both Node and Bun); realtime WebSocket lives on the Bun-native hub — Bun's `node:http` cannot host WebSockets (a raw 101 write never flushes), so the hub is a separate `Bun.serve` listener.

## Docker

```bash
docker compose build
docker compose up -d     # http://localhost:3081  ·  ws://localhost:3082
```

The Dockerfile is a two-stage build:

- **Build** stage: `node:22-bookworm-slim` runs `npm ci` + `tsc -b` + `vite build`.
- **Runtime** stage: `oven/bun:1.3.14` ships Bun + compiled output + built frontend and runs `bun run packages/aether-backend/src/main.ts` under `dumb-init`, with a `/health` healthcheck (`curl`).

`docker-compose.yml` remaps host ports to `3081`/`3082` (avoiding the common local `3001`) and mounts `${HOME}/.omp:/root/.omp` so the container sees your host model config — remove that mount for a throwaway catalog.

## Repo layout

| Path                           | What it is                                                           |
| ------------------------------ | -------------------------------------------------------------------- |
| `packages/aether-core`         | Foundation: events, lifecycle, config, types, utils, telemetry, RBAC |
| `packages/aether-memory`       | Memory + vector stores, RAG                                          |
| `packages/aether-orchestrator` | LangGraph workflow engine, checkpointing, visualizer                 |
| `packages/aether-tools`        | Tool registry, shell/Docker/Playwright/Python-venv/TS sandboxes      |
| `packages/aether-backend`      | HTTP/WS server, engine, loops, skills, models, static GUI            |
| `packages/aether-frontend`     | React + Vite web GUI                                                 |
