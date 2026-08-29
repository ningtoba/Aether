# Aether

> Autonomous AI orchestration platform — build, manage, and run multi-agent workflows, loops, and skills from a single web app.

Aether is a web-first platform for orchestrating autonomous AI agents. It embeds the [Oh My Pi](https://github.com/can1357/oh-my-pi) coding agent (a fork of [Pi](https://github.com/badlogic/pi-mono), MIT) behind a compact TypeScript monorepo, so you get a production-grade agent engine (sessions, tools, subagents, compaction, 60+ provider catalog) with a GUI that exposes **everything** — models, sessions, loops, skills, providers, agents, and settings — over one HTTP/WebSocket API.

No desktop app. No separate services. Run one Docker command, open the browser, drive the platform.

---

## Quick Start

### One command — Docker

```bash
docker compose up -d
# open http://localhost:3081  (GUI + API)
# realtime engine events: ws://localhost:3082
```

The image builds the whole monorepo, serves the React GUI statically from the backend, and embeds the agent engine (Bun + the omp SDK). Health check at `/health`.

> Note: the host ports are remapped to **3081 (GUI/API)** and **3082 (realtime)** because port 3001 on typical dev hosts is held by other local services (e.g. the Hermes MCP gateway). The container itself listens on internal 3001/3002.

### Local development

```bash
npm install
npm run build        # tsc -b --force over all packages
npm run build:frontend   # vite build -> packages/aether-frontend/dist

# Run the backend under Bun (the engine requires the Bun runtime):
bun run packages/aether-backend/src/main.ts
# → http://localhost:3001  (GUI + API)  ·  ws://localhost:3002 (realtime)
```

Set `PORT`, `HOST`, `REALTIME_PORT`, `AETHER_API_KEY` to taste. Leave `AETHER_API_KEY` unset for open local dev.

---

## The one-paragraph architecture

```
Browser (React GUI)
   │  HTTP/WS
   ▼
aether-backend (Bun)
   ├── REST + WebSocket API (/api/*, /health)
   ├── StaticFileServer  → serves the built frontend (same port)
   ├── EngineService     → embeds @oh-my-pi/pi-coding-agent (sessions)
   ├── LoopManager       → round→transition→round loop runner
   ├── SkillsService     → discovers SKILL.md packs (.omp/skills, ~/.omp/agent/skills)
   └── BunRealtimeHub    → ws://<host>:<REALTIME_PORT>/ live engine events
```

The backend runs on **Bun** (the omp SDK only runs under Bun). The plain-Node `node:http` server, router, and hardened WebSocket manager remain for the REST/API surface; a Bun-native `Bun.serve` websocket hub carries the live engine event stream to the GUI.

### The 6 packages

| Package           | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `aether-core`     | Foundation: events, lifecycle, config, types, utils, telemetry (OTel/pino), RBAC |
| `aether-memory`   | In-memory + vector memory stores, RAG engine, scoped stores   |
| `aether-orchestrator` | LangGraph workflow graph engine, checkpointing, visualizer  |
| `aether-tools`    | Tool registry, shell + Docker + Playwright + Python-venv + TS-runtime sandboxes |
| `aether-backend`  | HTTP/WS server, embedded agent engine, loops, skills, models, static GUI |
| `aether-frontend` | React + Vite web GUI (dashboard, sessions, loops, skills, models, providers, agents, settings) |

Node 22+ for tooling/tests; **Bun ≥ 1.3.14** at runtime.

---

## The agent engine (sessions, loops, skills)

Aether's engine is the embedded **Oh My Pi** coding agent — the same MIT harness omp ships — driven in-process via its Node SDK (`@oh-my-pi/pi-coding-agent`). That buys the full agent surface without writing a harness: provider/model catalog (60+ providers, custom `models.yml` entries), streaming tool use, subagents, compaction, retries, and session management.

### Sessions

A session is one persistent agent conversation with a chosen model. From the **Sessions** page you open a session against any model in the catalog, prompt it, and watch the assistant stream live (text, thinking, tool calls) over the realtime websocket. Compact and dispose are one click.

### Loops — indefinite, workflow-controlled

A Loop repeats a prompt on a persistent session, and after every round runs the **transition you configure** — the key workflow-control primitive:

```
[round N prompt] → [transition] → [round N+1 prompt] → ...
```

Transitions you can pick between rounds:

| Transition | Effect                                                      |
| ---------- | ----------------------------------------------------------- |
| `none`     | straight to the next round                                   |
| `compact`  | run `session.compact()` (housekeeping before the next round) |
| `skill`    | invoke a discovered skill on the session                     |
| `gate`     | pause; the user decides *continue / stop / edit* in the GUI  |

Stop conditions: **maxRounds**, **maxTimeMs**, **manual stop** — or leave both unset for an **indefinite** loop. A `gate` transition makes a loop fully interactive: `[1st loop] → [⏸ gated — you decide] → [compact] → [2nd loop] → …`. Every loop emits a live event stream (`loop:start`, `round_start`, `round_end`, `transition`, `gated`, `stop`, `completed`) to the GUI.

### Skills

Skills are `SKILL.md` packs discovered from `<project>/.omp/skills/<name>/SKILL.md` and `~/.omp/agent/skills/<name>/SKILL.md` (standard agent-skill layout, frontmatter optional). Browse them in the **Skills** page and reference one as a loop transition (`skill:<name>`).

---

## API

Everything the GUI does is available over the API.

| Resource  | Endpoints                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Health    | `GET /health` (includes `realtime.port` + `engine.available`)                                          |
| Models    | `GET /api/models` — grouped model catalog from the omp registry                                       |
| Sessions  | `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/prompt`, `POST /api/sessions/:id/compact`, `POST /api/sessions/:id/dispose` |
| Loops     | `GET/POST /api/loops`, `GET/DELETE /api/loops/:id`, `POST /api/loops/:id/start`, `POST /api/loops/:id/stop`, `POST /api/loops/:id/advance` |
| Skills    | `GET /api/skills`                                                                                      |
| Agents    | `GET/POST /api/agents`, `PUT/DELETE /api/agents/:id`                                                   |
| Providers | `GET/POST /api/providers`, `DELETE /api/providers/:id`, `GET /api/providers/:id/health`                 |

Engine-backed routes return **501** when the backend runs without Bun/omp (so the API degrades cleanly). When `AETHER_API_KEY` is set, `/api/*` requires `Authorization: Bearer <key>` or `X-API-Key` and enforces RBAC (admin role).

**Realtime:** connect to `ws://<host>:<REALTIME_PORT>/` and negotiate with `{ "filter": ["engine"] }`. Frames:

```jsonc
{ "type": "engine",
  "payload": { "namespace": "session"|"loop", "sessionId"?, "event": { "kind": "...", ... } },
  "timestamp": "..." }
```

---

## Development

```bash
npm test                       # 579 vitest tests across the 6 packages
npm run build                  # tsc -b --force over the monorepo
npm run lint && npm run format:check
npm run dev:frontend           # vite dev server (proxy → backend :3001)
```

### Adding a model

The engine's model catalog comes from the omp registry — custom providers/models live in `~/.omp/agent/models.yml` (see omp's provider docs), e.g.:

```yaml
providers:
  spark:
    baseUrl: http://127.0.0.1:8000/v1
    api: openai-completions
    models:
      - id: my-model
        name: My Model
```

The **Models** page and both Session/Loop model pickers read this catalog live.

### Docker

```bash
docker compose build
docker compose up -d     # http://localhost:3081
```

The Dockerfile is a two-stage Bun image (`oven/bun`): build stage runs `npm ci` + `tsc -b` + `vite build`; the runtime stage ships Bun + compiled output + built frontend and runs `bun run packages/aether-backend/src/main.ts` under `dumb-init`, with a `/health` healthcheck.

---

## Roadmap

- Persist loop definitions + session transcripts to disk (currently in-memory).
- Loop `skill`-transition skill picker with per-round argument templating.
- RBAC role-based GUI access + per-route permissions beyond admin.
- Provider CRUD wired to the engine registry (add a provider from the GUI).

---

## License

MIT.
