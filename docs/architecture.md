# Architecture (as built today)

Conveyor turns a parameter form into a running print: **generate → slice → transport**. This page maps the
system as it exists on `main`. It is not the rewrite plan; when the code changes, this page changes in the
same PR.

## Services

```mermaid
flowchart LR
  B[Browser PWA] -->|https| C[Caddy]
  C -->|page routes| W[web: SvelteKit]
  C -->|/api/*, prefix stripped| A[api: Fastify]
  A -->|enqueue, read snapshot, subscribe| R[(Redis: BullMQ + pub/sub)]
  K[worker: BullMQ Worker] -->|claim job, publish status| R
  A --> D[(SQLite /data/conveyor.db)]
  K --> D
  K --> F[/data/&lt;jobId&gt;/ artifacts/]
  K --> E[OpenSCAD, Orca or PrusaSlicer CLIs]
  K --> P[Printers: Moonraker, Elegoo]
```

| Service | Code | Role |
|---|---|---|
| `caddy` | `Caddyfile` | TLS (the PWA's service worker needs https) and path routing. API namespaces never share a prefix with a page route. |
| `web` | `packages/web` | SvelteKit 3 + Svelte 5 PWA on `adapter-node`, in Svelte 4 (non-runes) component syntax. Client-side procedural Three.js preview ([ADR 0002](adr/0002-dual-model-preview.md)). |
| `api` | `packages/api` | Fastify REST + WebSocket. Validates requests with zod, checks compatibility, enqueues, relays status to `/jobs/:id/ws`. Session auth (`CONVEYOR_PASSWORD`, `CONVEYOR_AUTH_SECRET`). |
| `worker` | `packages/worker` | BullMQ `Worker` on the Redis queue, where `WORKER_CONCURRENCY` (default 2) caps all running jobs. On the SQLite queue it caps only jobs running an engine; one waiting at or on the printer doesn't count ([worker](modules/worker.md)). Runs the three stages through in-process plugin adapters ([ADR 0001](adr/0001-plugin-isolation.md)). G-code uploads stream from disk, so a transfer doesn't hold the file in memory. |
| `redis` | `docker-compose.yml` | Queue, live `job:<id>` snapshot, `job:<id>:status` channel. |

### Queue modes

This page shows the default, `CONVEYOR_QUEUE=redis`. With `CONVEYOR_QUEUE=sqlite` plus
`CONVEYOR_QUEUE_UNSTABLE=1`, the api and the worker run jobs from the `jobs` table instead: the worker claims a
leased row, live status goes to `job_events`, and the api polls that table for `/jobs/:id/ws`. Redis is not
used for jobs in that mode. Both services must get the same value. The rollout is in
[design/sqlite-queue.md](design/sqlite-queue.md), and the code as built in
[modules/worker.md](modules/worker.md).

## Packages

| Package | Depends on | Holds |
|---|---|---|
| `@conveyor/shared` | zod | Stage contracts, job and event types, registry, profiles, SQLite access (`bun:sqlite`) |
| `@conveyor/api` | shared, plugin registry | HTTP routes in `src/routes/` (`jobs` with its `job-stream`, or `jobs-sqlite`, by queue mode, sharing `job-common`; `generators`, `uploads`, `auth`, `catalog`, `printer-holds`) |
| `@conveyor/worker` | shared, plugin registry | Job loop, status bus, profile resolution |
| `@conveyor/web` | shared | Routes `/`, `/jobs`, `/jobs/:id`, `/monitor`, `/settings` |
| `plugins/generators/*` | shared | `gridfinity` (OpenSCAD over the `scad/` submodule), `passthrough` (uploaded STL) |
| `plugins/slicers/*` | shared | `orca`, `prusa` (headless CLIs) |
| `plugins/registry/builtin` | every plugin | `buildRegistry`, the one list of bundled plugins the api and worker share |
| `plugins/transports/*` | shared | `moonraker` (Klipper HTTP), `elegoo` (SDCP over WebSocket) |
| `tools/visual` | standalone | Captures screenshots and GIFs of the stub-mode stack for UI PRs ([ADR 0003](adr/0003-visual-evidence.md)) |

Contracts are in [PLUGINS.md](PLUGINS.md).

## A job's trip

1. The PWA posts `{ generator, params, printerId, profileId }` to `POST /api/jobs`.
2. The api resolves the printer → transport and the profile → slicer, runs `validateJobRequest`, enqueues on
   BullMQ and answers `202 { jobId }`. The PWA opens `/api/jobs/:id/ws`, which Caddy hands to the api as `/jobs/:id/ws`.
3. The worker claims the job and publishes `generating`, `slicing`, `transferring`, then printer progress.
   Artifacts land in `/data/<jobId>/` and pass between stages as path handles.
4. On a terminal state the worker writes the job row to SQLite; the Redis `job:<id>` snapshot is written with a plain `SET` and no TTL, so it stays until something deletes it.
5. `POST /api/jobs/:id/cancel` cancels; `GET /api/jobs/:id/artifact/:kind` downloads the STL or g-code.

Full sequence with failure paths: [SEQUENCE.md](SEQUENCE.md).

## State and storage

| Store | Truth for |
|---|---|
| Redis | In-flight jobs: queue, live snapshot, status fan-out |
| SQLite (`DB_PATH`) | Printers, profile edits, finished job history |
| `/data/<jobId>/` | `model.stl`, `model.gcode` |
| `/profiles` (read-only) | Bundled slicer profile defaults, the reset target for edits |

Schema and rationale: [DATA-MODEL.md](DATA-MODEL.md).

## Runtime and build

- Bun runs TypeScript directly: no compile step, no `dist/`. `mise.toml` pins the toolchain.
- `CONVEYOR_ENGINE_STUB=1` replaces the engines with stubs so the pipeline runs without OpenSCAD or a slicer.
- Images: three Dockerfiles (`packages/{api,worker,web}/Dockerfile`). `release.yml` publishes multi-arch
  images to GHCR on `v*` tags. The worker image bakes in OpenSCAD and the slicers
  ([archive/M1-WORKER-ENGINES.md](archive/M1-WORKER-ENGINES.md)).

## Known gaps

The audit issues on GitHub (label `audit`) track where today's code falls short of [AGENTS.md](../AGENTS.md):
Svelte 4-style components instead of a decided UI stack, thrown errors instead of `Result`, comments still in the ratchet
baseline, and low test coverage.
