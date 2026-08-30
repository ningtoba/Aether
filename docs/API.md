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
- [Agents](#agents)
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

## Workspaces

Pick a real working directory (on the host) for Sessions and Loops — each can
target a different directory so the agent edits separate host projects at the
same time. Paths are confined to configured roots (`AETHER_WORKSPACES`,
colon-separated; defaults to the host home). In Docker the compose file mounts
the host home (or projects) at the same absolute path and runs as the host
user, so a chosen path maps to real, host-owned files.

### `GET /api/workspaces`

List the configured workspace roots → `200 { workspaces: [{ path, label }] }`.

### `GET /api/workspaces/browse?path=/abs`

List subdirectories of `path` (must be within a root) → `200 { path, entries: [{ name, path, isDir }], parent? }`. Omit `path` to start at the first root.

Sessions and loops accept an optional `cwd`; when provided it must exist and be
a directory (a chosen working directory outside the roots is rejected with
`400`).

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
      "stats": {
        "messages": 4,
        "toolCalls": 1,
        "tokens": {
          "input": 46900,
          "output": 135,
          "reasoning": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 47035,
        },
        "cost": 0,
        "context": { "tokens": 24000, "contextWindow": 1049000, "percent": 2.2 },
      },
    },
  ],
}
```

Each summary includes a `stats` field (message/token totals + context usage) for the GUI status line — mirroring omp's status bar in the terminal.

````

### `POST /api/sessions`

Create a session. Body: `{ "model": { "provider": "…", "modelId": "…" }, "cwd"?: "…", "resumePath"?: "…" }` → `201 { session, warning? }`. `session.sessionFile` is the durable omp journal path (present once the first assistant message materializes the file). `resumePath` — a `path` from `GET /api/omp/sessions` — restores that transcript's context into the new live session; a path outside omp's session roots, or one that cannot be opened, answers `404 { "error": "session not found" }` with no filesystem detail. `warning` is set on resume when the journal's model could not be restored.

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
````

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
  for every schema path. When API auth is enabled, paths the schema flags as
  credentials are replaced by presence markers (`true` = non-empty stored,
  `false` = empty/absent) — secrets never echo back.
- `PUT /api/omp/settings` with `{ "path": "…", "value": … }` → writes one setting
  through the SDK's `Settings.set()/flush()` to the user config (real values,
  including credentials).

### `GET /api/omp/providers`

Every AI provider omp knows — bundled, custom (`~/.omp/agent/models.yml`), and
discoverable runtime servers (ollama / llama.cpp / vLLM) — as engine-derived
truth from the live `ModelRegistry` + `AuthStorage`:

```jsonc
{
  "providers": [
    {
      "id": "local-server",
      "name": "local-server",
      "baseUrl": "http://192.168.1.10:8000/v1", // when the catalog/entry carries one
      "modelCount": 3,
      "models": ["…up to 20 sample ids…"],
      "authenticated": true, // authStorage.hasAuth — live truth, never guessed
      "discoverable": false, // runtime-discovery provider class
      "custom": true, // models.yml owns the entry → deletable
      "authOrigin": "api_key", // getCredentialOrigin kind (older SDKs: absent)
      "discoveryStatus": "ok", // per-provider discovery state (when available)
    },
  ],
}
```

See [Providers](#providers-1) for the mutation verbs and security notes.

### `GET /api/omp/agents`

Agent definitions: bundled subagents (`task`, `scout`, `reviewer`,
`security-reviewer`, `librarian`, `designer`, `init`) plus user/project agent
markdown from `~/.omp/agent/agents/*.md` and `<project>/.omp/agents/*.md`.

### `GET /api/omp/skills`

Every `SKILL.md` pack omp discovers (user, project, and managed-skills
sources), with full bodies — a superset of `GET /api/skills`.

### Persisted sessions

- `GET /api/omp/sessions` → persisted omp sessions on disk across projects
  (id, path, cwd, display name, modified). Engine GUI sessions appear here once
  their journal materializes — and each row's `path` is exactly what
  `POST /api/sessions`' `resumePath` takes.
- `GET /api/omp/sessions/read?path=<url-encoded jsonl path>` → a parsed transcript:
  `{ ok: true, transcript: { id, path, name, messages: [{ role, text, timestamp }] } }`.
  The path is confined server-side: only regular `.jsonl` files resolving inside
  omp's session roots are readable; anything else returns a fixed
  `{ ok: false, error: 'session not found' }` 404 with no filesystem detail.

---

## Agents

The legacy simulated `/api/agents` CRUD (in-memory Map, 500-record cap) is
REMOVED; those paths answer the uniform `404 { "error": "Not found" }`. The
real agent plane is `GET /api/omp/agents` — the engine's live omp catalog
(see [Omp facade](#omp-facade-engine-capabilities)).

Wrong-method requests to a registered path answer `405` with an `Allow` header; unknown API paths answer the uniform `404 { "error": "Not found" }`.

---

## Providers

The provider control plane lives under `/api/omp/providers*` and is backed by
the engine's LIVE instances: catalog from the warm `ModelRegistry`,
credentials from omp's `AuthStorage` (SQLite at `~/.omp/agent/data/agent.db`),
custom providers from `~/.omp/agent/models.yml`. All verbs map to the
`providers:config` RBAC permission (`read` for the catalog, `write` for the
rest — see [Authentication & RBAC](#authentication--rbac)). With the engine
not running under Bun every mutation answers `501`.

### `PUT /api/omp/providers/:id/key`

Body `{ "apiKey": "…" }` (1–4096 chars after trim) stores the key in omp's
`AuthStorage` for ANY known provider (bundled or `models.yml`-custom).
→ `200 { "ok": true, "provider": "…", "authenticated": true }`. Unknown ids
answer `400 { "error": "unknown provider" }`. **The submitted key never
appears in any response, error text, or log line** — a failed write answers
the fixed `500 { "error": "provider key write failed" }` for exactly that
reason.

### `DELETE /api/omp/providers/:id/key`

Drops the stored key. `authenticated` in
`200 { "ok": true, "provider": "…", "authenticated": false }` is the
POST-removal `hasAuth` truth — oauth/env-sourced credentials can legitimately
keep it `true`; it is never a guess.

### `POST /api/omp/providers`

Adds a custom provider to `~/.omp/agent/models.yml` (atomic tmp+rename write;
unrelated config keys and every other provider entry are preserved):

```jsonc
{
  "name": "mylocal",                     // ^[a-z0-9][a-z0-9_-]{0,63}$
  "baseUrl": "http://10.0.0.2:8000/v1",  // must parse as an http(s) URL
  "apiKey": "sk-…",                      // optional; REQUIRED when models[] is non-empty
  "auth": "none",                        // only accepted value: keyless local server
  "api": "openai-completions",           // optional wire format (this is the default)
  "models": [                            // optional, ≤ 500 entries
    { "id": "m1", "contextWindow"?: 8192, "maxTokens"?: 1024 }
  ]
}
```

→ `201 { "ok": true, "provider": "mylocal" }` — the NAME only; an inline
`apiKey` is never echoed. `409` when the name is already a bundled provider or
already present in `models.yml` (cap: 500 custom entries). `400` on any
validation failure (bad name, non-URL baseUrl, `models[]` without a key and
without `auth: "none"`, non-integer/non-positive `contextWindow`/`maxTokens`,
over-cap models). `500` with fixed text when `models.yml` cannot be read or
written. Registry semantics stay omp's: a bundled `config` block with the same
name still wins over the custom entry.

### `DELETE /api/omp/providers/:id`

Removes a `models.yml`-owned provider AND its stored key → `200 { "ok": true }`.
Anything `models.yml` does not own is bundled:
`400 { "error": "built-in providers cannot be deleted; remove their key instead" }`.

### `POST /api/omp/providers/:id/verify`

Honest 4-second reachability probe of `<baseUrl>/models` (baseUrl from the
live registry, falling back to the `models.yml` entry; the key comes from
`AuthStorage.peekApiKey` — no OAuth refresh). The model LIST is never
returned, only its count:

```jsonc
{ "ok": true, "provider": "ollama", "reachable": true, "modelCount": 12 }
{ "ok": true, "provider": "x", "reachable": false, "modelCount": null, "reason": "timeout" }
// reason: "no-base-url" | "timeout" | "network" | "http-<status>"
```

The probe reports; it never throws — engine-side failures degrade to reason
codes, so the GUI can render truth without error handling.

### Security notes

- **Keys are never serialized.** No provider response, error body, or server
  log line ever contains a submitted or stored key; every failure path on the
  credential routes uses a fixed message.
- Credential-flagged settings paths are excluded from
  `GET /api/omp/settings/values` (presence markers only — see Settings above);
  keys held in `AuthStorage` are invisible to `GET /api/models` and
  `GET /api/omp/providers` (auth STATE only).
- An inline `apiKey` in `POST /api/omp/providers` is persisted to
  `~/.omp/agent/models.yml` — that is omp's own storage semantics for custom
  providers. Prefer `PUT /api/omp/providers/:id/key` to keep keys in
  `AuthStorage` and out of the YAML file.

The legacy simulated `/api/providers` CRUD (in-memory Map, `simulated: true`
health stubs) is REMOVED; those paths answer the uniform
`404 { "error": "Not found" }`. `/health` `providers` counts are now
engine-derived too (`configured` = distinct catalog provider ids, `healthy` =
`hasAuth` truth), TTL-memoized server-side and honestly `{0, 0}` before the
engine warms.

---

## Realtime WebSocket

Connect to `ws://<host>:<REALTIME_PORT>/` (port advertised in `/health.realtime.port`). Subscribe to events with a filter frame:

When `AETHER_API_KEY` is set, the realtime port requires credentials on the
**upgrade**: `Authorization`/`X-API-Key` headers aren't available to browser
`WebSocket`, so clients first call `POST /api/realtime-ticket` (authenticated
REST) for a single-use 30-second ticket, then connect
`ws://<host>:<REALTIME_PORT>/?ticket=<t>`. With auth disabled the endpoint
returns `{ "ticket": null }` and the socket opens uncredentialed. Regardless
of auth, upgrades are origin-gated: a browser `Origin` must be same-host
(or listed in `AETHER_CORS_ORIGINS`).

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
- Every `/api/*` route resolves to a concrete RBAC permission — there is no
  unmapped fail-open path. Catalog/status reads fall back to `system:* read`;
  the filesystem browser needs `workspaces:* read` and raw on-disk transcript
  reads need `sessions:* read`; no builtin non-admin role holds those.
- `POST /api/realtime-ticket` (auth-gated) mints the single-use realtime
  ticket described under [Realtime WebSocket](#realtime-websocket).

**Engine availability:** session/loop/skill/model routes return `501` (not `500`) when the backend runs without the Bun runtime or the omp SDK, so clients can degrade cleanly.
