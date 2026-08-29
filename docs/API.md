# Aether API Reference

The backend exposes a JSON REST API (`/api/*`) and a realtime WebSocket stream. Everything the web GUI does is available over this API.

**Base URL:** `http://<host>:<PORT>` (default `3001`).

---

## Table of contents

- [Health](#health)
- [Models](#models)
- [Sessions](#sessions)
- [Loops](#loops)
- [Skills](#skills)
- [Agents & Executions](#agents--executions)
- [Providers](#providers)
- [Realtime WebSocket](#realtime-websocket)
- [Authentication & RBAC](#authentication--rbac)

---

## Health

### `GET /health`

Container/liveness probe; stays open even when API auth is enabled.

```jsonc
{
  "status": "ok",
  "version": "0.2.0",
  "uptime": 341,
  "memory": { "rss": 315154432, "heapTotal": 46922752, "heapUsed": 56162713, "external": 14374489 },
  "providers": { "configured": 0, "healthy": 0 },
  "timestamp": "2026-08-29T14:53:44.621Z",
  "realtime": { "port": 3002 },
  "engine": { "available": true, "error": null },
}
```

`realtime.port` is where the WebSocket hub listens; `engine.available` reports whether the embedded omp agent engine is wired (Bun runtime + SDK resolvable).

---

## Models

### `GET /api/models`

Model catalog grouped by provider, sourced live from the omp model registry (custom `~/.omp/agent/models.yml` entries included).

```jsonc
{
  "groups": [
    {
      "provider": "local-server",
      "models": [
        {
          "id": "deepseek-ai/DeepSeek-V4-Flash-0731",
          "name": "DeepSeek V4 Flash (H200)",
          "provider": "local-server",
          "contextWindow": 1048576,
          "maxTokens": 393216,
          "baseUrl": "http://192.168.1.10:8000/v1",
          "isEmbedded": false,
        },
      ],
    },
  ],
}
```

Both the Session and Loop model pickers read this endpoint.

---

## Sessions

A session is one persistent agent conversation bound to a model. Created sessions are held in-memory by the backend; prompt results stream over the [realtime WebSocket](#realtime-websocket).

### `GET /api/sessions`

```jsonc
{
  "sessions": [
    {
      "id": "ses_1",
      "name": "ses_1",
      "cwd": "/app",
      "model": { "provider": "local-server", "modelId": "deepseek-ai/DeepSeek-V4-Flash-0731" },
      "status": "idle",
      "messageCount": 0,
      "createdAt": "2026-08-29T14:53:44.621Z",
    },
  ],
}
```

### `POST /api/sessions`

Create a session. Body: `{ "model": { "provider": "…", "modelId": "…" }, "cwd"?: "…" }` → `201 { session }`.

### `GET /api/sessions/:id`

Return one session's summary → `200 { session }` or `404`.

### `GET /api/sessions/:id/transcript`

Replay a live session's journal as rich entries — thinking, tool calls with args/results, and assistant text — for inspection (e.g. the loop inspector). → `200 { transcript: { id, entries: [{ kind, ... }] } }` or `404`.

```jsonc
{
  "transcript": {
    "id": "ses_1",
    "entries": [
      { "kind": "user", "text": "…" },
      { "kind": "thinking", "text": "…" },
      { "kind": "tool", "name": "bash", "args": "…" },
      { "kind": "tool", "name": "bash", "result": "…", "isError": false },
      { "kind": "assistant", "text": "…" },
    ],
  },
}
```

### `POST /api/sessions/:id/prompt`

Run a prompt on the session. Body: `{ "message": "…" }` → `202 { accepted: true, sessionId }`. The prompt executes asynchronously; the assistant's streamed reply arrives as `session` frames on the realtime hub.

### `POST /api/sessions/:id/compact`

Run compaction on the session's context. → `200 { ok: true }`. On a conversation too small to compact ("No context to compact") this still returns `ok`.

### `POST /api/sessions/:id/dispose`

Tear down a session and free its resources → `200 { ok: true }`.

---

## Loops

A loop repeats a prompt on a fresh session and, after every round, runs the transition you configure:

```
[round N prompt] → [transition] → [round N+1 prompt] → …
```

Transitions: `none | compact | skill | gate`. Stop conditions: `maxRounds`, `maxTimeMs`, manual `stop`, or **indefinite** (neither cap set).

### `GET /api/loops`

List saved loop definitions → `200 { loops: LoopDefinition[] }`.

### `POST /api/loops`

Save (create or replace by `id`) a loop definition → `201 { loop }`.

```jsonc
{
  "name": "Enhancement loop",
  "prompt": "Improve the project. Round {round}:",
  "transition": { "kind": "compact" }, // none | compact | skill | gate
  "transition": { "kind": "skill", "skillName": "review" },
  "maxRounds": 10, // omit/0 for indefinite
  "maxTimeMs": 3600000, // omit/0 for indefinite
  "model": { "provider": "local-server", "modelId": "deepseek-ai/DeepSeek-V4-Flash-0731" },
}
```

### `GET /api/loops/:id`

Loop definition plus current run progress → `200 { loop, progress }`.

### `DELETE /api/loops/:id`

Delete a loop definition (fails while it is running) → `200 { ok: true }`.

### `POST /api/loops/:id/start`

Start (or restart) the loop on a fresh session → `200 { progress }`.

### `POST /api/loops/:id/stop`

Stop a running loop → `200 { progress }`.

### `POST /api/loops/:id/advance`

Resolve a paused `gate`. Body: `{ "action": "continue" | "stop" }` → `200 { progress }`. `continue` proceeds to the next round; `stop` halts the loop.

### Loop progress shape

```jsonc
{
  "id": "…",
  "status": "idle|running|gated|stopped|completed|error",
  "currentRound": 2,
  "startedAt": "…",
  "stopReason": "max rounds reached",
  "rounds": [{ "round": 1, "startedAt": "…", "finishedAt": "…", "summary": "…", "errored": false }],
}
```

---

## Omp facade (engine capabilities)

The facade exposes everything the embedded omp engine can do beyond the session
surface — capabilities, settings, providers, agents, skills, and persisted
sessions — read from the SDK defensively so a future omp upgrade degrades to
"unavailable" instead of breaking the GUI. Routes return `501` when the engine
isn't running under Bun.

### `GET /api/omp/status`

Engine capability report: runtime, omp version, and per-feature availability.

```jsonc
{ "status": { "available": true, "runtime": "bun", "version": "18.0.10",
  "capabilities": [ { "name": "createAgentSession", "available": true }, … ] } }
```

### Settings (schema-driven)

- `GET /api/omp/settings` → the full omp settings schema (tabs, groups, and
  every setting with type/label/description/enum) — generated from omp's own
  `SETTINGS_SCHEMA` so the GUI editor tracks omp releases.
- `GET /api/omp/settings/values` → `{ values: { "<setting.path>": <current> } }`
  for every schema path.
- `PUT /api/omp/settings` with `{ "path": "…", "value": … }` → writes one setting
  through the SDK's `Settings.set()/flush()` to the user config.

### `GET /api/omp/providers`

Every AI provider omp knows (bundled + custom in `models.yml` + discoverable),
with model counts, base URLs, auth status, and sample model ids.

### `GET /api/omp/agents`

Agent definitions: bundled subagents (`task`, `scout`, `reviewer`,
`security-reviewer`, `librarian`, `designer`, `init`) plus user/project agent
markdown from `~/.omp/agent/agents/*.md` and `<project>/.omp/agents/*.md`.

### `GET /api/omp/skills`

Every `SKILL.md` pack omp discovers (user, project, and managed-skills
sources), with full bodies — a superset of `GET /api/skills`.

### Persisted sessions

- `GET /api/omp/sessions` → persisted omp sessions on disk across projects
  (id, path, cwd, display name, modified).
- `GET /api/omp/sessions/read?path=<url-encoded jsonl path>` → a parsed
  transcript (`{ messages: [{ role, text, timestamp }] }`).

---

## Agents & Executions

## Agents & Executions

### `GET|POST /api/agents`, `GET|PUT|DELETE /api/agents/:id`

Agent-registry CRUD (records + config). Body for create: `{ "name": "…", "config"?: {…} }`.

### `GET|POST /api/executions`, `GET /api/executions/:id`, `POST /api/executions/:id/cancel`

Execution-run tracking (in-memory).

---

## Providers

### `GET|POST /api/providers`, `DELETE /api/providers/:id`, `GET /api/providers/:id/health`

Provider-configuration CRUD. Note: the embedded engine's model catalog comes from the omp registry (`~/.omp/agent/models.yml` + bundled providers), not this list — see `GET /api/models`.

---

## Realtime WebSocket

Connect to `ws://<host>:<REALTIME_PORT>/` (port advertised in `/health.realtime.port`). Subscribe to events with a filter frame:

```jsonc
{ "filter": ["engine"] }
```

Server frames:

```jsonc
{ "type": "engine",
  "payload": { "namespace": "session" | "loop" | "hub", "sessionId"?: "…", "event": { "kind": "…", … } },
  "timestamp": "…" }
```

**Session event kinds:** `turn_start`, `message_start`, `message_update` (streaming text/thinking deltas), `tool_call`, `tool_result`, `message_end`, `agent_end`, `session_error`.

**Loop event kinds:** `loop:start`, `loop:round_start`, `loop:round_end`, `loop:round_error`, `loop:transition`, `loop:gated`, `loop:stop`, `loop:completed`.

---

## Authentication & RBAC

Set `AETHER_API_KEY` to enable API auth:

- Requests must present the key via `Authorization: Bearer <key>` or `X-API-Key`.
- A single key authenticates as the `admin` role; a key→role map configures per-key roles.
- `/health` stays open for container probes.
- Unauthorized → `401`; authorized-but-forbidden → `403`.

**Engine availability:** session/loop/skill/model routes return `501` (not `500`) when the backend runs without the Bun runtime or the omp SDK, so clients can degrade cleanly.
