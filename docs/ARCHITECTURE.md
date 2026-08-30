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
```

### Why the runtime is Bun

The omp SDK (`@oh-my-pi/pi-coding-agent`) only runs under the **Bun** runtime (its native N-API addon and tooling assume Bun). Decisions that follow:

- The production backend (`packages/aether-backend/src/main.ts`) runs under `bun`.
- The REST surface keeps the battle-tested `node:http` server implementation (works under Bun and Node; the node vitest suite exercises it without the Bun-only SDK).
- Bun's `node:http` cannot host WebSockets (raw 101 writes on the upgrade socket never flush, and there is no `server.upgrade`), so live engine events flow through a **Bun-native `Bun.serve` hub** on `REALTIME_PORT` (advertised in `/health`). REST + realtime are two listeners in one process.
- The omp SDK is loaded **lazily** (dynamic `import()` inside `EngineService`), so the module graph stays plain-Node-safe and the node test suite never pulls in the Bun addon.

## Package layout

| Package           | Depends on                                  | Responsibilities                                                                                                                                                                     |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aether-core`     | —                                           | Events (`EventBus`), lifecycle, config, shared types, utils, telemetry (pino + OpenTelemetry), security (RBAC). Merged from the former types/utils/core/telemetry/security packages. |
| `aether-backend`  | `aether-core` + `@oh-my-pi/pi-coding-agent` | HTTP/WS server, engine service, loop manager, skills service, model catalog, static GUI hosting.                                                                                     |
| `aether-frontend` | `aether-core`                               | React + Vite web GUI.                                                                                                                                                                |

Dependency flow is strictly leaf → root: `core → backend → frontend`.

The former `aether-electron`, `aether-sdk`, and `aether-providers` packages are gone: the SDK/provider layer is superseded by the embedded omp engine and its model registry; the Electron shell by the web GUI. In v0.3.6 `aether-memory`, `aether-orchestrator`, and `aether-tools` were deleted too: a repo-wide grep proved zero importers (the orchestrator's node runners returned canned outputs, and the tools sandboxes are superseded by the omp SDK's own session tools).

## Backend internals

### Request path

1. `AetherServer` (node:http) handles `handleRequest`:
   - CORS preflight → 204.
   - Body-size cap → 413 before reading bytes.
   - Optional API-key auth (`Authorization: Bearer`/`X-API-Key`, constant-time compare) + fail-closed RBAC for `/api/*`; `/health` stays open; realtime hub upgrades are origin-gated always and credential-gated when auth is on.
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

- API key auth (`Authorization: Bearer` / `X-API-Key`) with constant-time digest comparison (`crypto.timingSafeEqual`). Auth is opt-in via `AETHER_API_KEY`; the server logs a loud warning at startup when it runs unauthenticated on a non-loopback bind.
- RBAC (hierarchical roles + glob resources) is **fail-closed over every `/api/*` route**: `routePermission` is total — workspaces browse needs `workspaces:* read` and raw disk-transcript reads `sessions:* read`, resources no builtin non-admin role holds; catalog/status reads fall back to `system:* read` and everything else to `system:* read|write`. A route-table totality test enumerates the live router so new routes cannot slip through a table gap.
- CORS is **same-origin-only by default** (no `Access-Control-Allow-Origin` header is ever emitted unless the request `Origin` exactly matches an entry in `AETHER_CORS_ORIGINS`). Both WebSocket surfaces run an origin gate on every upgrade: browser `Origin`s must be same-host (port may differ, so `localhost:3081 → :3002` works) unless an explicit list is configured (`'*'` restores allow-any).
- The realtime hub (`:3002`) is no longer an open second entry point: upgrades pass the origin gate first, then a credential gate — `Authorization: Bearer`, `X-API-Key`, `?apikey=`, or a **single-use 30 s ticket** from `POST /api/realtime-ticket` (what the GUI uses, keeping long-lived keys out of socket URLs). The hub binds `HOST` and logs its actual bound address.
- `GET /api/omp/settings/values` redacts credential-flagged settings to presence markers when auth is enabled; writes still accept real values.
- `GET /api/omp/sessions/read` confines every read to regular `.jsonl` files whose realpath resolves inside omp's session roots; all other paths return a fixed 404 with no filesystem detail. Workspace/working-directory validation likewise compares **realpaths**, so a symlink cannot escape configured roots.
- Engine routes return 501 (not 500) when the engine is unavailable; unexpected exceptions are logged server-side and answer a fixed 500 — only actionable rejections (engine unavailable, loop working-directory guidance, unserved model) reach the client verbatim. The simulated `/api/executions` surface was removed in v0.3.7; the legacy `agents`/`providers` in-memory registries are capped at 500 records (→ 503).
- Static file serving rejects path traversal/absolute escapes; only GET/HEAD.
- Process posture: `unhandledRejection` is logged and survived; `uncaughtException` exits 1 so the container restarts clean. The live session map is capped (`MAX_LIVE_SESSIONS`, default 64, idle-evict) and drained on shutdown; loop-owned sessions are disposed on every terminal path. Engine-session journals are durable in omp's session store (`SessionManager.create`), so eviction/restart detaches a session without destroying its transcript — `resumePath` reopens it.

## Testing & verification

- Full vitest suite (`npm test`) across the three packages — run under Node, never importing the Bun-only omp SDK.
- `npm run build` = `tsc -b --force` (whole monorepo); `npm run lint` and `npm run format:check` gate CI.
- CI: lint/format/madge, type-check, tests, then a Docker image build (`package.yml`).

## Operation

- `docker compose up -d` → GUI at `http://localhost:3081`, realtime `ws://localhost:3082`. Both host ports are published on `127.0.0.1` only (drop the prefix to opt into LAN exposure — then also set `AETHER_API_KEY` + `AETHER_CORS_ORIGINS`).
- Env: `PORT` (default 3001), `REALTIME_PORT` (3002), `HOST` (`0.0.0.0`), `MAX_BODY_SIZE`, `MAX_LIVE_SESSIONS` (64), `AETHER_API_KEY`, `AETHER_CORS_ORIGINS` (comma-separated exact origins; unset = same-origin-only, `*` = allow-any).
- Model catalog: `~/.omp/agent/models.yml` + omp provider catalog; the GUI reads it live.

## Roadmap

- API-key/role provisioning UX (roles are already honored end-to-end across REST and the realtime ticket flow; keys are provisioned via env today).
