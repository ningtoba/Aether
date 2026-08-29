# Aether

Autonomous AI orchestration platform — build, run, and control agent sessions, loops, and skills from a single web app.

Aether embeds the [Oh My Pi](https://github.com/can1357/oh-my-pi) coding agent (a fork of [Pi](https://github.com/badlogic/pi-mono), MIT) behind a compact TypeScript monorepo. You get a production-grade agent engine — sessions, streaming tool use, subagents, compaction, a 60+ provider model catalog — exposed through a web GUI and one HTTP/WebSocket API.

No desktop app, no separate services. **One command, open a browser, drive the platform.**

---

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
# GUI + API  → http://localhost:3081
# realtime   → ws://localhost:3082
```

> Host ports are remapped to `3081`/`3082` because port `3001` on typical dev hosts is held by other local services (e.g. the Hermes MCP gateway). The container itself listens on internal `3001`/`3002`, and mounts your host omp config (`~/.omp`) so the engine sees your models.

### Local development

```bash
npm install
npm run build             # tsc -b --force
npm run build:frontend    # vite build
bun run packages/aether-backend/src/main.ts
# → http://localhost:3001  ·  ws://localhost:3002
```

Requires **Bun ≥ 1.3.14** at runtime (the agent engine only runs under Bun) and **Node 22+** for tooling/tests.

---

## What you get

| Capability   | What it does                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sessions** | Persistent agent conversations. Pick any model in the catalog, prompt it, watch text/thinking/tool calls stream live. Compact and dispose in one click.                                                                                                 |
| **Loops**    | Indefinite, workflow-controlled runs: `[round N] → [transition] → [round N+1]`. Configure per-round transitions — `none`, `compact`, `skill`, or an interactive `gate` where _you_ decide what happens next — plus `maxRounds`/`maxTimeMs`/manual stop. |
| **Skills**   | `SKILL.md` capability packs discovered from `.omp/skills` and `~/.omp/agent/skills`; browse them and wire one in as a loop transition.                                                                                                                  |
| **Models**   | Live catalog from the omp registry (60+ providers + custom `models.yml`), used by every model picker.                                                                                                                                                   |
| **Web GUI**  | Dashboard, Sessions, Loops, Skills, Models, Providers, Agents, Settings — every API capability has a view.                                                                                                                                              |

---

## Documentation

| Doc                                      | What it covers                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)     | System topology, the 6 packages, why the runtime is Bun, backend internals, security, operations. |
| [API Reference](docs/API.md)             | Every REST endpoint + the realtime WebSocket protocol, with request/response shapes.              |
| [Development Guide](docs/DEVELOPMENT.md) | Setup, build/run/test, adding a model, Docker, and where the engine code lives.                   |
| [Changelog](docs/CHANGELOG.md)           | Release history.                                                                                  |

---

## Roadmap

- Persist loop definitions + session transcripts to disk (currently in-memory).
- Loop `skill`-transition picker with per-round argument templating.
- RBAC role-based GUI access + per-route permissions beyond admin.
- Provider CRUD wired to the engine registry (add a provider from the GUI).

---

## License

MIT.
