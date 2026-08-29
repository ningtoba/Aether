## What you get

| Capability    | What it does                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sessions**  | Full agent console. Pick any model in the catalog, prompt it, watch text/thinking/tool calls stream live over WebSocket, compact, and dispose. Plus a browser over omp's persisted sessions on disk (every project, transcripts included).                  |
| **Loops**     | Indefinite, workflow-controlled runs: `[round N] → [transition] → [round N+1]`. Transitions — `none`, `compact`, `skill`, or an interactive `gate` where _you_ decide — plus `maxRounds`/`maxTimeMs`/manual stop. Loop definitions persist across restarts. |
| **Skills**    | Every `SKILL.md` pack omp discovers — user, project, and managed-skills sources — browsable with full bodies on demand; wire any one in as a loop transition.                                                                                               |
| **Models**    | Live catalog from the omp registry (60+ providers + custom `models.yml`), used by every model picker.                                                                                                                                                       |
| **Providers** | Searchable catalog of every provider omp knows (70+, with model counts and base URLs), plus custom provider registration.                                                                                                                                   |
| **Agents**    | omp's real agent definitions (bundled `task`/`scout`/`reviewer`/… + user/project agent markdown) with source, description, and inspectable bodies.                                                                                                          |
| **Settings**  | Schema-driven editor generated from omp's own `SETTINGS_SCHEMA` — every config knob across all 10 tabs, written back to your user config.                                                                                                                   |
| **Web GUI**   | Dashboard, Sessions, Loops, Skills, Models, Providers, Agents, Settings — every API capability has a view.                                                                                                                                                  |

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

- Session transcript persistence into omp's real session store (currently engine-sessions are in-memory; disk transcripts are read-only).
- Loop `skill`-transition picker with per-round argument templating.
- RBAC role-based GUI access + per-route permissions beyond admin.
- Provider CRUD wired to the engine registry (add a provider from the GUI).
- Skill create/import flow writing `SKILL.md` into user/project skill dirs.

---

## License

MIT.
