# Aether Changelog

Historically the README carried an ever-growing list of per-iteration bullet
points. Those long-form updates now live here so the README stays an operator
landing page. The project tags each iteration as a `v0.1.x` / `v0.2.x` release.

---

## v0.3.5 — lifecycle discipline + the closed authz loop (2026-08-30)

Third audit iteration: a lifecycle lens over the engine/loop object graph and
an authz lens over the network surface, every finding pre-verified by
independent read-only scouts, then fixed by four parallel implementation
waves with discriminating tests (62 new; 692 total).

CRITICAL closed — the realtime hub was a second, unauthenticated entry point:

- `:3002` upgraded every WS connection unconditionally — no key, no Origin
  check, even with `AETHER_API_KEY` set — and streamed live transcripts and
  tool output to any TCP peer (any web page in the operator's browser could
  open `ws://127.0.0.1:3082`). Upgrades now run an origin gate first
  (same-host by default) and a credential gate when auth is on: Bearer /
  `X-API-Key` / `?apikey=` or a single-use 30 s ticket from the new
  `POST /api/realtime-ticket`. The hub binds `HOST` (it silently bound
  `0.0.0.0` while logging `127.0.0.1`) and logs its actual address.
- The legacy `:3001` WS default flipped from "any Origin" to the same
  host-match rule — one rule for both sockets.

Auth completeness:

- RBAC route authorization was fail-open: 10 registered routes (workspaces
  browse, disk transcripts, models/skills, omp status) resolved to a null
  permission and passed with authentication alone — a `viewer` key could
  browse `$HOME` and read every on-disk session. `routePermission` is now
  total: `workspaces:*`/`sessions:*` resources for the two sensitive groups,
  `system:*` fallback for the rest, pinned by a test that enumerates the
  live router table.
- The GUI can finally run against a protected backend: Settings stores a
  tab-scoped API key, REST attaches it, and realtime opens with a fresh
  single-use ticket per connection (long-lived keys stay out of socket
  URLs).
- Credential-flagged omp settings values are redacted to presence markers on
  reads when auth is enabled; writes are unchanged.

Lifecycle & resilience:

- Loop-owned sessions were created per start and never disposed — now
  disposed on completion, start-rejection, and manual stop; the live session
  map is capped (`MAX_LIVE_SESSIONS`, default 64, idle-evict) and drained on
  shutdown.
- A rejected `prompt()` escaped as an unhandled rejection (crash-by-default
  on Node ≥15/Bun); the route now reports it through the session's error
  channel, and `main.ts` survives logged rejections while exiting 1 on
  `uncaughtException`.
- Mid-round manual stop left loops status `running` forever with the
  max-time timer armed; stop now clears, finalizes, and emits the terminal
  event. Indefinite loops no longer accumulate every round reply in memory
  (200-entry window + `totalRounds`), `compact()` can no longer race a
  running prompt (409), and session `createdAt` is real.

Honesty pass:

- Provider health stopped fabricating `reachable` + random latency (now
  `unknown`/`simulated`); simulated execution records self-describe
  (`simulated: true`); `POST /api/providers` rejects an `apiKey` field with
  a pointer to where keys actually live; both in-memory registries are
  capped at 500.
- `/health` version comes from the backend manifest (was a pinned `0.1.0`
  literal; the manifest now matches root `0.2.0`).
- Workspace validation compares realpaths — a symlinked directory no longer
  slips through the lexical containment check.

Verification: 692 tests / 44 files, `tsc -b --force` clean, lint 0 errors,
prettier clean. The route-table totality, hub-auth, and ticket anti-replay
tests were discrimination-checked (reverting each fix turns them red).

---

## v0.3.4 — GUI redesign + security hardening (2026-08-30)

An audit-driven iteration: the web GUI was redesigned against a proper design
system, and two CRITICAL security defects found by adversarial review were
closed.

Security (backend):

- `GET /api/omp/sessions/read?path=…` previously passed the raw query value to
  `readFileSync` — any host file could be read or probed (the old 404 body even
  echoed `ENOENT`/`EACCES`/`EISDIR` plus absolute paths), on a route with no
  RBAC mapping, in a deployment that published the API on all LAN interfaces.
  Reads are now confined to regular `.jsonl` files whose realpath resolves
  inside omp's session roots; every other path returns a fixed
  `session not found` 404 with zero filesystem detail.
- CORS was hardcoded `*` with no way to close it: any web page left open in the
  developer's browser could drive `POST /api/sessions` + prompt — i.e. drive-by
  agent execution with the user's tools. CORS is now same-origin-only by
  default (no `Access-Control-Allow-Origin` at all unless the request `Origin`
  exactly matches `AETHER_CORS_ORIGINS`); the same list now actually gates
  legacy WebSocket upgrade origins, and starting unauthenticated on a
  non-loopback bind prints a loud warning.
- `docker-compose.yml` publishes `127.0.0.1:3081`/`127.0.0.1:3082`; LAN
  exposure is an explicit opt-in (documented alongside `AETHER_API_KEY`).
- API-key comparison now uses `crypto.timingSafeEqual` (the digest compare
  claimed constant-time but `Buffer.equals` short-circuits).
- `shell`/`sandbox-ts` child runs now settle on `exit` after a 250 ms drain
  window: Bun never closes stdio pipes for signal-killed children, so
  `def.timeoutMs` was silently ignored and dangling handles pinned the loop.

GUI (all eight views):

- Real design-token layer (`src/tokens.css`): layered surfaces, hairline
  borders, AA text ramp, status hues with soft variants, spacing/radius/shadow
  scales, motion tokens, `color-scheme: dark` — replacing the partial palette
  embedded in `index.html` and ~16 off-token hexes.
- Shared primitives (`src/components/ui.tsx`): 28 hand-authored SVG icons (no
  more emoji), `PageHeader`/`Card`/`StatCard`/`StatusPill`/`EmptyState`/
  `ErrorState`/`Skeleton`/`SegmentedControl`/`ConfirmButton`/`CopyButton` and
  `fmtCompact`/`fmtRelative` (token counts render as `1M`/`262K`).
- Chat is a proper surface: distinct user/assistant/tool role chips and tinting
  (user messages were styled identically to assistant — the CSS rule never
  existed), tool results capped at 240 px with show-more instead of flooding
  the transcript, auto-scroll only when you are already near the bottom,
  multiline textarea (Shift+Enter newline) with an IME composition guard,
  actionable empty states, loop inspector as a real dialog (role, Escape,
  autofocus).
- No more lying states: Dashboard skeletons while loading instead of confident
  "0" cards with swallowed errors (`catch(() => {})`), collected
  `role=alert` errors with Retry; false empty-state flashes during fetch fixed
  on Loops/Sessions/Skills; Models/Providers/Agents gained loading +
  actionable empty states.
- Accessibility & responsiveness: visible `:focus-visible` rings,
  `aria-current`/`aria-pressed`, labeled inputs, contrast ramp ≥ 4.5:1,
  `prefers-reduced-motion`; sidebar collapses to an icon rail and side-by-side
  rails stack at ≤ 1100 px; wide tables scroll instead of clipping.
- Sessions/Loops UX: visible selection states, searchable lists, busy-guard on
  session creation, destructive actions behind ConfirmButton, model pickers
  self-correct to models actually in the catalog.

Verified: 630 tests / 40 files, `tsc -b --force` clean, lint 0 errors,
prettier clean; the new path-confinement tests were discrimination-checked
(guard bypassed → 3 failures) and the CORS suite proves the default server
emits no `Access-Control-Allow-Origin`.

---

## v0.3.3 — truthful model-error diagnostics (2026-08-30)

Session prompts no longer claim "the model may not be available on the
configured server" when a turn actually fails for a known reason.

- The engine now surfaces omp's real turn error (`errorMessage`, plus
  `stopDetails.type`/`explanation`) verbatim in `session_error` instead of the
  canned "model may not be available … try a different model" guess. A
  provider 404 for a catalog model the server does not serve, an auth
  failure, a timeout, or a refusal now shows its actual cause. Every session
  error is tagged with the responsible model id (`… — model:
  <provider>/<modelId>`), so a failing turn is self-identifying. The
  post-turn "no output" check is now gated to truly silent, error-free turns
  — a clean turn that streamed thinking but no text is a model response, not
  a failure.
- `createSession` preflights the resolved model against its provider's served
  model list — `GET <baseUrl>/models`, authenticated with the provider's
  stored key — and refuses to create a session on a catalog entry the server
  does not serve (e.g. `local-server/deepseek-ai/DeepSeek-V4-Flash` when only
  `…-0731` is running), with a message naming the served models. Best-effort:
  if the list is unreachable or unparseable, creation proceeds and the turn
  still reports the real error.

Verified with the real omp SDK + local vLLM: the unserved alias returns an
empty assistant message with `stopReason: "error"` and a 404 `errorMessage`;
`createSession` now rejects that alias upfront, and the served `-0731` model
prompts normally with no session error. 610 tests, tsc -b, lint 0 errors,
prettier clean.

---

## v0.3.2 — omp-fidelity chat rendering (2026-08-30)

Chat windows (Sessions + loop inspection) now render like the omp terminal
instead of a flat text/JSON console.

- Assistant + user messages render as real markdown (headings, bold, lists,
  tables, links) with syntax-highlighted code blocks (react-markdown +
  remark-gfm + rehype-highlight) — no hand-rolled text formatting.
- Thinking is a collapsible dimmed block (click ▶ to expand) like omp.
- Tool calls are rich panels: tool name, args (inline for bash/python), a
  plain mono result (not markdown-mangled), and an error/ok status.
- A status line under the chat mirrors omp's status bar: model, message count,
  token totals (in/out), tool-call count, and context usage %.
- Backend: EngineSession.stats() exposes omp's per-session totals (tokens,
  cost, contextUsage); each session summary now carries `stats` so the GUI
  status line updates after every turn (agent_end).

Verified in-container: a markdown+table+code+bash-tool prompt renders real

<h3>/<strong>/hljs-highlighted code/<table>/tool blocks, and the status line
shows e.g. "tokens 47,035 · in 46,900 · out 135 · 1 tool calls · ctx 2%".
582 tests, tsc -b, lint 0 errors, prettier clean.

---

## v0.3.1 — Working directories per session/loop (2026-08-30)

Pick a real host working directory per session or loop, so the agent edits a
specific project (and different sessions/loops can target different projects
at the same time).

- New `WorkspacesService` + `GET /api/workspaces`, `GET /api/workspaces/browse`
  (browse subdirectories within configured roots; `AETHER_WORKSPACES` env,
  default host home). Sessions/loops accept an optional `cwd` that must exist
  and be a directory (400 otherwise).
- `CwdPicker` component wired into Sessions (new session) and Loops (editor):
  browse roots → into subdirectories → "Use this directory".
- Fixed cwd actually reaching omp's tools: the session's working directory is
  now threaded into `SessionManager.inMemory(cwd)` — tools (bash/read/edit)
  take their cwd from `sessionManager.getCwd()`, so without this the agent ran
  in the process cwd regardless of the requested directory.
- Docker now mounts the host home at the same path and runs the container as
  the host user (`user: "${AETHER_UID:-1000}:${AETHER_GID:-1000}"`,
  `HOME=${HOME}`), so a picked directory maps to real host files owned by the
  host user (the earlier root-owned `~/.omp/config.yml` churn is gone), and
  the `/root/.omp` mount is no longer needed.

Verified in-container: VibeTrader session tools `pwd` = `/home/nekophobia/
Projects/VibeTrader`; a simultaneous Aether session `pwd` = `/home/nekophobia/
Projects/Aether`; the GUI picker navigated and selected a directory; host files
remain host-user-owned after runs.

---

## v0.3.0 — Full omp GUI: settings, providers, agents, skills & persisted sessions (2026-08-30)

Made Aether a true GUI for the embedded omp engine — everything omp can do is
now reachable from the web app, wrapped in a defensive facade so omp upgrades
degrade gracefully instead of breaking the GUI.

**Omp facade (`OmpFacade`) + API**

- New `/api/omp/*` surface: `status` (runtime/version/per-feature capability),
  `settings` (full omp schema + values + write), `providers` (every omp
  provider with model counts), `agents` (bundled + user/project definitions),
  `skills` (all sources incl. managed-skills), `sessions` (persisted on-disk
  transcripts).
- Update-safe by design: lazy SDK import (Bun only), feature-detected exports,
  try/catch per call → missing exports surface as capability "unavailable",
  never a 500. Settings schema is generated from omp's own `SETTINGS_SCHEMA`
  (loaded via the `config/settings-schema` subpath).

**Web GUI**

- Dashboard: real aggregates (model/provider counts, skill count, persisted
  sessions, omp version + capabilities, memory, realtime state).
- Settings: schema-driven editor — all 10 omp config tabs, per-type controls,
  search, live save.
- Providers: searchable catalog of every omp provider + custom provider form.
- Agents: omp's real agent definitions (bundled + user/project `.md`).
- Skills: every discovered `SKILL.md` (65 on host) with expandable bodies.
- Sessions: fixed realtime streaming (port remap + message dedup), plus a
  persisted-session browser for omp's on-disk transcripts.
- Loops: advanced editor with `{round}` preview, model picker, full transition
  set; loop definitions now persist across restarts.

**Fixes**

- Realtime sessions now work under Docker: backend advertises the host-facing
  `REALTIME_PUBLIC_PORT` (3082) in `/health` instead of the container-internal
  port, so the browser connects to the reachable WS endpoint.

**Verification:** 582 vitest tests (+3 facade-route tests, 92 backend), `tsc -b`
clean, lint 0 errors, prettier clean; browser-driven E2E across all 8 pages
(including a live session prompt and a settings write) against the built image.

---

## v0.2.0 — Web-first restructure with an embedded omp agent engine (2026-08-29)

Abolished the Electron desktop shell and made Aether a single-image web platform.

**Consolidation (17 → 6 packages)**

- Deleted `aether-electron`, `aether-sdk`, `aether-providers` (superseded by the embedded omp/Pi engine and its model registry).
- Merged `types`/`utils`/`core`/`telemetry`/`security` into `aether-core`.
- Merged `tools`/`docker`/`playwright`/`python-venv`/`ts-runtime` into `aether-tools`.
- Collapsed the monorepo tsconfig graph to the 6 surviving packages.

**Agent engine**

- `EngineService` embeds `@oh-my-pi/pi-coding-agent` (the MIT omp/Pi harness) in-process, loaded lazily so the node test suite never touches the Bun-only SDK.
- `LoopRunner` implements the workflow-controlled loop model: `[round N] → [transition] → [round N+1]` with `none | compact | skill | gate` transitions and `maxRounds` / `maxTimeMs` / manual / indefinite stops.
- `LoopManager` surfaces start / stop / gate-advance control; `SkillsService` discovers `SKILL.md` packs.
- Model catalog served live from the omp registry (60+ providers + custom `models.yml`).

**Web GUI + deployment**

- `aether-frontend`: React/Vite SPA — Dashboard, Sessions (live streaming), Loops (editor + runner with per-round gates), Skills, Models, Providers, Agents, Settings.
- Backend serves the built GUI statically from the same port; a Bun-native WebSocket hub (`REALTIME_PORT`) streams engine events.
- Two-stage Docker image; `docker compose up -d` → http://localhost:3081.

**Verification:** 579 vitest tests, `tsc -b` clean, lint 0 errors, format green; GUI browser-driven end-to-end and loop runs against a local vLLM both on-host and in Docker.

---

## v0.1.x — Hardening iterations (Electron era)

The earlier history below is summarized from the git log. Each rev locked a
fresh-lens audit pass: three independent review scopes → evidence-backed fixes
→ dual-adversarial pre-commit review → README/verification sync.

### v0.1.17 — Graph rendering & SDK contract wiring

Mermaid output quotes/escapes every node/edge id; SDK remainder wrappers wired correctly. 715 tests.

### v0.1.16 — Lifecycle safety, utils hardening, scoped-store contracts

WebSocket `attach()` idempotent; utils + scoped memory store + orchestration checkpoint fixes. 705 tests.

### v0.1.15 — Sandbox isolation, vector search, Docker/Playwright correctness

`createVenv` no longer deletes non-venv directories; vector-search guards; Docker tmpfs + playwright delay semantics. 689 tests.

### v0.1.14 — Shell I/O, provider routes, config & server hardening

Shell `stdin` actually piped (was blocking on an empty pipe); provider route validation + health wiring; config/server hardening. 676 tests.

### v0.1.13 — Async tracing, RAG retrieval & routing correctness

OTel context manager installed (async spans now propagate); RAG retrieval/scoring; edge routing + SDK result correctness. 667 tests.

### v0.1.12 — Provider resolution & Electron-bridge correctness

Longest-prefix capability lookup (dated `gpt-4o-mini-…` no longer resolves to `gpt-4o`); electron bridge execution guard. 656 tests.

### v0.1.11 — Utility & tooling correctness

Graphviz DOT escaping (backslash-first), SDK tool enabled/timeout, `isEqual`/`deepMerge`, GraphEditor ids, parallel/truncate guards. 643 tests.

### v0.1.10 — API resilience & telemetry correctness

Malformed URLs → 400 (not 500/hang); cancel-before-start; agent-body validation; histogram/label/tracer/vector correctness. 632 tests.

### v0.1.9 — Conditional end routing

WorkflowBuilder accepts `END`/`__end__` as an edge target for conditional early exit. 623 tests.

### v0.1.8 — Core-contract truth (SDK run result, engine state, RAG filters)

`AetherRunner.toRunResult` derives turns/usage from `rawResponses` + `newItems` (the installed SDK exposes neither `turns` nor `usage`); engine `currentNode`/signal-pause; RAG filter truth. 621 tests.

### v0.1.7 — Reliability parity

`MemoryStore` honors `defaultTtlMs`; event-bus subscriber isolation; Gemini batch embeddings. 616 tests.

### v0.1.6 — API authentication & RBAC

Authenticated HTTP/WebSocket API (`Authorization: Bearer` / `X-API-Key`, constant-time compare) with role-based authorization. 605 tests.

### v0.1.5 — Credential-storage hardening

Encrypted vault is the real no-keychain backend (removed the plaintext fallback); atomic writes, 0600 perms, serialized RMW cycles. 601 tests.

### v0.1.4 — Streamed tool/text completion

OpenAI-family + Anthropic + Gemini streams fold into a correct final `done` (accumulated text + tool calls). 594 tests.

### v0.1.3 — Tool-loop wire fix

`Message` gained `toolCalls`/`toolCallId`; multi-turn tool use works on every provider (previously 400s / lost correlation). 590 tests.

### v0.1.2 — Deployability, CI & provider wire fixes

Production server entrypoint, working Electron IPC/quit, CI/Docker/packaging repair, provider wire fixes. 585 tests.

### v0.1.1 — Security & cross-platform hardening

Native-side fixes: Windows `.cmd` shim execution via `process.execPath` + `tsx` entry, cmd.exe argument quoting, WebSocket receive buffering bounds by chunk count (not just bytes). 580 tests.

---

## v0.1.0 — Initial platform (2026-05)

Monorepo scaffold (17 packages) with:

- Provider abstraction for 6 LLM backends (OpenAI, Anthropic, Gemini, Ollama, vLLM, llama.cpp, OpenRouter, + more).
- LangGraph-based workflow orchestrator with checkpointing + Mermaid/DOT visualizers.
- Memory system: in-memory + vector stores, RAG engine, scoped stores.
- Tool runtime: registry, shell + Docker sandboxes, browser automation (Playwright), Python venv + TS runtime executors.
- Electron desktop shell with a React renderer + IPC bridge to the backend.
- OpenTelemetry tracing + pino logging; RBAC security module.
- ~470 tests at first documented feature-complete state.
