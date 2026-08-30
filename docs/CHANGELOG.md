# Aether Changelog

Historically the README carried an ever-growing list of per-iteration bullet
points. Those long-form updates now live here so the README stays an operator
landing page. The project tags each iteration as a `v0.1.x` / `v0.2.x` release.

---

## v0.4.0 — the image ships what CI type-checks; bounded realtime; last simulated
plane gone (2026-08-30)

- **The Docker runtime now executes the compiled artifact.** CMD was
  `bun run …/src/main.ts` — the image built `dist/` but never ran it, so the
  type-checked build and the shipped runtime could drift silently. CMD is now
  `bun run packages/aether-backend/dist/main.js`; `resolveFrontendDist` was
  verified to resolve the GUI dir identically from `dist/` (same module depth).
  Live container PID-1 cmdline confirmed post-rebuild.
- **The last simulated control plane is gone.** The in-memory `/api/agents*`
  registry was deleted (same clean cutover as `/api/providers` in v0.3.7):
  uniform 404, no shim, GUI fallback removed — the Agents page shows omp's
  real agent definitions or an explicit error. `GET /api/agents` against the
  redeployed container answers 404. Generic-machinery tests that used the
  route as a vehicle (CORS preflight, RBAC 401/403, body-size guards, 405
  policy, malformed-URL 400) were retargeted to live routes, none dropped.
- **The Bun realtime hub got the outbound bound it shipped without.**
  `broadcast()` fanned frames out with no backlog limit — one stalled client
  could grow its socket buffer unboundedly. Per-client cap now mirrors the
  legacy manager's `MAX_WS_OUTBOUND_BACKLOG` (1 MB; at-cap keeps, above-cap
  terminates; Bun send-status 0 or a throwing send evicts), degrading
  gracefully when the runtime lacks the backpressure APIs. 9 new tests,
  mutation-proven.
- **The static GUI server's guards are finally pinned.** 18 new tests for the
  previously untested `static-server.ts`: raw `../` traversal → 403
  `Forbidden`, encoded/backslash variants never decoded (current no-decode
  semantics pinned so a future decoder fails loudly), html `no-cache` vs
  immutable asset caching, SPA fallback, GET/HEAD-only (others fall through
  to the router), JSON 404 when the dist has no index. Three guard-mutation
  runs confirmed the tests discriminate.
- **Dead weight removed:** unused `@langchain/langgraph` dependency (lockfile
  shrank by 343 lines), zero-caller exports `OmpFacade.hasCapability()` and
  `SkillsService.invalidate()`, ARCHITECTURE.md's hardcoded test count and
  two already-shipped roadmap bullets.
- **GUI design pass — 14 deltas from a designer vision review of all eight
  views, each re-verified in the browser against the redeployed container:**
  the loops editor is now visibly bound to the selected row
  (`Editing · <name>` vs `+ New loop`, `is-selected` styling, sticky
  Create/Run CTA, two-step delete); session rows lead with a bright basename
  over a dim dirname, ids show a 12-char prefix with the full value on hover,
  the model pill shows its basename, and the persisted section cap carries
  its count (`PERSISTED (OMP ON DISK · 116)`); the dashboard sessions card
  can no longer contradict itself (`0 live · 116 on disk`) and not-exported
  SDK chips collapse behind `+ N internal`; all-caps labels raised to
  `--text-dim`; search placeholders shortened with a 240px floor; the active
  segmented filter gets a real fill; skill descriptions clamp uniformly with
  full text on hover; model table numeric headers align with their values.
- 625 tests green (27 new; the simulated-registry suite deleted with the
  registry); `tsc -b --force`, lint, and `format:check` clean.

---

## v0.3.9 — provider rows you can actually read (2026-08-30)

GUI-enhancement pass (design scout + vision-verified screenshots of the
deployed build).

- **The provider table stopped clipping.** Action labels were being cut
  mid-word at the card edge (`chan…`, `remo…`) with no scroll affordance —
  verified from screenshots. Labels are now short, complete words (`key`,
  `revoke`, `verify`, `delete`, `models`), pills are compact
  (`configured` / `via config` / `models.yml` / `keyless`), and the action
  cluster keeps its natural width inside the scrollable table so buttons
  can never shrink-clip again. A search box + jump-to-provider select
  front the provider catalog.
- **The reachability result moved to the Auth column.** The `reachable` /
  `unreachable` pill produced by `POST /:id/verify` describes the
  provider's endpoint/credential, not an action — sitting in the action
  cluster it clipped mid-word the moment you verified. It now stacks under
  the auth pills with the probe's reason code (`http-401`, `timeout`,
  `network`, `no-base-url`) on hover.
- **Dashboard health copy is true**: `providers: 2 configured · 67 in
  registry` replaces `2 of 67 configured`, which implied the other 65 were
  half-configured. 67 is what `/health` counts (distinct providers owning
  at least one registry model); the Providers table renders 70 rows because
  `listProviders` appends the same set's `getDiscoverableProviders()` entries
  that have no static models — that append is the +3.
- Probe semantics are unchanged from v0.3.8 and remain as documented in
  [API.md](API.md): one 4-second request to `<baseUrl>/models`, key from
  `AuthStorage.peekApiKey`, reason-coded failures, model lists never
  returned.
- Live verification: key rotate → `configured` stays, verify → green
  `reachable` pill in the Auth column; filtered and unfiltered table
  screenshots re-inspected after each change. 611 tests green.

## v0.3.8 — provider control plane: real auth truth, key provisioning, custom providers (2026-08-30)

Sixth audit iteration: provider-surface, secret-hygiene and GUI-polish scouts,
all CRITICAL/MAJOR claims reproduced against SDK source before contracting, then
four parallel implementers (backend cutover, bind-guard, Providers-page rework,
four-page design pass).

- **The auth column became true.** `OmpFacade.listProviders` derived
  `authenticated` from a `Model.authenticated` field the SDK has never set — every
  one of the ~70 catalog rows was structurally pinned to "not configured" and
  `/health` `providers.healthy` was permanently 0. Provider auth truth now comes
  from the live `authStorage.hasAuth(id)` via EngineService's warm instances, with
  `authOrigin` (`via config / api_key / oauth / env …`), `custom` (models.yml
  ownership) and `discoveryStatus` added to the DTO. Live check: 70 rows, exactly
  the 2 genuinely keyed providers report configured.
- **Key provisioning is real.** `PUT /api/omp/providers/:id/key` persists through
  `AuthStorage.set` (SQLite credential store), `DELETE` revokes via `remove`, and
  `POST /:id/verify` probes `baseUrl/models` with the resolved key (4 s timeout,
  reason-coded, model lists never returned). Keys are write-only: no response,
  error or log line can echo them (discriminated by tests and by the live probe).
- **Custom providers: GUI → `models.yml`.** The dead in-memory registry, its four
  legacy verbs, the "Save & verify" name-matching fiction and its 400-redirect to
  a settings path that never existed are deleted. `POST/DELETE
  /api/omp/providers` now validate, merge and atomically rewrite `models.yml`
  (0600 live file, 0600-or-absent `.bak`, unrelated keys preserved byte-for-byte),
  hot-reload the engine (`registry.refresh` + targeted `refreshProvider`), and the
  session-usable model set no longer diverges from the catalog after a write.
- **Startup bind guard (audited MAJOR):** the backend defaulted to `0.0.0.0` with
  auth opt-in — a LAN-reachable unauthenticated API that can create sessions and
  run agent tools. `HOST` now defaults to `127.0.0.1`; non-loopback binds refuse
  startup unless `AETHER_API_KEY` or an explicit `AETHER_ALLOW_UNAUTHENTICATED=1`
  opt-in is present (the Docker image sets the flag deliberately; compose keeps
  publishing 127.0.0.1-only). Loopback dev flow unchanged.
- **Secret-hygiene fixes:** the credential mask now honors the SDK's `ui.secret`
  spelling (was: latent raw-value leak on future schema entries);
  record-typed credentials (`images.urls.credentials`) no longer report
  "configured" from an empty default; invalid loop-store rows log id/name instead
  of the raw record.
- **GUI design pass (17 findings → closed):** Providers rebuilt around the new
  truth (per-row key set/rotate/revoke + verify, `models.yml` pill + delete,
  honest copy); Models surfaces per-group "not configured" against the live
  flag; dead shared-style bypasses closed repo-wide (`.truncate` URL cells,
  `.list-row` skill rows with real source-tone mapping, `.field .req`,
  `.card-ghost.is-selected`, `.form-narrow` on Settings, unified search widths);
  the Settings RBAC note points at `/api/omp/providers*`.
- Tests 562 → **611** (34 files): +engine-level provider discriminators
  (cast-injected warm engine proves bundled-name 409 leaves `models.yml`
  byte-identical, and create→delete preserves unrelated providers/keys and
  0600 perms), store backup/perms invariants, verb-level contract tests with
  key-echo oracles, bind-guard table, settings-mask coverage; legacy provider
  suites deleted with their routes.

## v0.3.7 — durable sessions + resume, executions surface cut, hardening pass (2026-08-30)

Fifth audit iteration: three fresh-lens scouts (session-persistence feasibility,
the never-audited service surface, GUI design + external references), every
MAJOR source-verified before fixing, then three parallel implementers.

- **Session transcripts are now durable.** Engine sessions run on disk-backed
  `SessionManager.create(cwd)` journals under omp's session roots (lazy
  materialization — never-prompted sessions write nothing), so restarts,
  cap-evictions and disposes no longer destroy transcripts; the GUI's
  persisted-session browser gained a one-click **Resume**: `POST /api/sessions`
  accepts `resumePath`, confined server-side (realpath must resolve inside
  omp's session roots; rejection is a fixed 404, never a path echo), restores
  the conversation context via `SessionManager.open`, and forwards the SDK's
  model-restore warning verbatim. Roadmap item closed. Live-verified on the
  container: codeword → restart → resume → recall.
- **`/api/executions` deleted.** The simulated timer-chain registry had zero
  consumers (no page, no nav, dead API wrappers only); routes, RBAC branch,
  DTOs, tests and docs removed. `/api/agents` stays (the GUI reads it) and is
  now capped (500 → 503) with body/name validation mirroring the provider
  registry.
- **Hardening (audited defects):** `PUT /api/omp/settings` now validates the
  path against omp's `SETTINGS_SCHEMA` before writing (arbitrary keys could be
  planted into the user's live omp config); `SkillsService` got a 30 s TTL memo
  (it re-read every `SKILL.md` body, whole tree, on every request and every
  loop round); unexpected engine exceptions answer a fixed 500 after logging
  server-side instead of echoing paths/SDK internals (actionable rejections —
  engine-down, loop cwd guidance, unserved model — stay visible); wrong
  methods on registered paths answer 405 with an `Allow` header; unknown API
  paths return the uniform 404 shape; every request gets one `[http]`
  access-log line; explicit `requestTimeout`/`headersTimeout`; `Vary: Origin`
  on CORS denials.
- **GUI (design iteration):** one-click Resume on the disk-session panel; two
  MAJOR honesty/visual fixes (double trash glyph on destructive rows, the
  loop inspector's unconditional pulsing “streaming live” pill — now conditional
  with an honest `no run` state, and titled by loop name, not UUID); real
  `ws://host:port` instead of the literal `ws://…:`; legacy provider counters
  qualified; Sessions hero leads with the informative count; clamp-2
  descriptions; badge tones carry meaning (provenance blue, health green,
  “reachable” vs “live”); the designed `.search` component unified across all
  seven list filters (was dead CSS); short 8-char session ids with copy;
  constrained form measure (`.form-narrow`); new design tokens — `--fs-*`
  type scale, `--border-hover`/`--border-active`, `--fill-neutral` — from
  reference research (Vercel Geist roles, Primer alpha-derived neutral fills,
  Linear's near-black canvas), cinema-dark preserved.
- Tests: 548 → **562 across 32 files** (+7 persistence/resume discriminators
  incl. a `inMemory`-banned sentinel and confinement-first negative proofs,
  +405/validation/schema-gate suites; −11 simulated-surface tests with the
  surface).

## v0.3.6 — loop-engine integrity, GUI deep-links, dead weight cut (2026-08-30)

Fourth audit iteration: three fresh-lens scouts (frontend correctness, loop
semantics, package boundaries), every MAJOR claim source-verified before a
fix, then two parallel implementation waves with discriminating tests.

Dead weight removed (the "six packages" are three):

- `aether-memory`, `aether-orchestrator` and `aether-tools` deleted — a
  repo-wide grep proved zero importers outside their own packages. The
  orchestrator's LangGraph node runners returned canned `{status:'ok'}`
  outputs, and the tools sandboxes are superseded by the omp SDK's own
  session tools; both dragged `@langchain/langgraph`, `dockerode` and
  `playwright-core` through the whole build and into the runtime image.
  Their 179 self-tests no longer pad the green count.

Loop-engine integrity (all pinned by tests with pre-fix discriminators):

- `EngineSession.prompt` now resolves `'ok' | 'busy' | 'error'` instead of
  swallowing its two silent failure modes. A busy-rejected or errored/
  zero-output round is recorded `errored: true` with a real reason — the
  runner no longer marks such rounds successful with the PREVIOUS round's
  reply as summary, which had been defeating round-error stop policies.
- `LoopManager.start()` reserved its slot synchronously (the guard used to
  sit across an `await createSession`: two concurrent starts got two
  runners, one unstoppable).
- The loop store is durable: `persist()` writes tmp + rename (a crash can no
  longer truncate `loops.json`), a corrupt store is QUARANTINED to
  `loops.json.corrupt-<ISO>` and reported — never silently dropped or
  overwritten — and one bad entry is skipped loudly instead of taking the
  healthy majority with it.
- `transition.kind` is validated at the save route against the single
  source-of-truth kind list; `LoopProgress.totalRounds` is typed (it had
  been load-bearing past the 200-round retention window but untyped).
- Roadmap closed: `skill` transitions take optional per-round `args` with
  `{round}` substitution (GUI field + 1..3 preview; no-`args` prompt stays
  byte-identical for existing loops).
- Provider stats report a `healthy` count derived from the real engine
  catalog, never from the size of the simulated registry.

GUI correctness (frontend's first non-design audit):

- CRITICAL: editing a saved loop silently reset its working directory to
  the workspace root — the edit form never hydrated `cwd`. Fixed via a pure
  `hydrateLoopFormEdit` helper pinned by a unit test.
- The realtime client leaked one live WebSocket + reconnect loop per page
  mount (nothing ever called `close()`); now an app-wide singleton with
  exponential backoff (1 s→30 s) and an `onReconnect` resync so events
  missed during a disconnect can't leave streaming blocks stuck forever.
- Deep-link routing: `#/<view>` for all eight views plus
  `#/sessions/<id>` / `#/loops/<id>` — F5 and shared links restore the
  exact view (loop deep-links open the inspector).
- Opening a live session showed an EMPTY console (the transcript endpoint
  was never called); stale-response races on rapid session/inspector
  switching; the per-second clock tick re-parsed every markdown block in
  the transcript (tick scoped to the status line, rows memoized);
  transcripts capped at 2000 items; api.ts header-merge order + default
  30 s timeout; unchanged settings values no longer PUT.

**548 tests / 33 files** (was 692 across six packages; 179 of those were
deleted-package self-tests) — tsc, lint, format, and the full suite green;
verified live in the browser against the rebuilt container, including the
F5 deep-link scenarios and the loop-edit cwd round-trip.

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

- `docker-compose.yml` now passes `AETHER_API_KEY`/`AETHER_CORS_ORIGINS`
  through to the container — until now the documented LAN-exposure runbook
  was a no-op because compose silently dropped both variables. Verified on
  the artifact: with the key set, uncredentialed REST and `:3082` upgrades
  401, Bearer upgrades 101, and a used ticket replays as 401.
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
