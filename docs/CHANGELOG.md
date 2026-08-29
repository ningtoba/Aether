# Aether Changelog

Historically the README carried an ever-growing list of per-iteration bullet
points. Those long-form updates now live here so the README stays an operator
landing page. The project tags each iteration as a `v0.1.x` / `v0.2.x` release.

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
