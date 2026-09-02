# Conveyor — Data Model & Storage

What Conveyor persists, where, and why. Two stores with a clean split of duties.

## Storage choice

| Store | Holds | Why |
|---|---|---|
| **SQLite** (file on the `/data` volume) | Durable config + job history: `stations`, `printers`, `profiles`, `jobs` | Self-hosted single-node app; a file DB needs no extra service, backs up by copying one file, and is plenty fast for this scale. |
| **Redis** | Live job state + status pub/sub (BullMQ queue, `job:<id>` snapshot, `job:<id>:status` channel) | Ephemeral, high-churn, fan-out to many WS clients. Already present for the queue. |
| **Filesystem** (`/data/<jobId>/`) | Artifacts: `model.stl`, `model.gcode` | Large binaries don't belong in a DB; stages pass `{path}` handles (ADR 0001). |
| **`/profiles/*`** (read-only mount) | Locked slicer profile **bundles** (Orca machine/filament/process JSON) | Curated by the operator, version-controlled outside the app, never user-editable. |

**Rule of thumb:** Redis is the *live* truth for an in-flight job; SQLite is the *durable* truth
for config and finished jobs. On a terminal state the worker writes the final `Job` row to SQLite;
the Redis snapshot is allowed to expire.

Recommended driver: `better-sqlite3` (synchronous, simple) with a thin migration runner, or Drizzle
if we want typed queries (matches the VROOM stack). Decided at M4, when the Settings page landed.

## Entities

```
profiles ──< stations >── printers
                 │
                 └──< jobs
```

### profile
A locked slicer configuration bundle. Rows are a catalog over the `/profiles` mount.

| column | type | notes |
|---|---|---|
| `id` | text PK | `"orca/klipper-pla-0.2"` |
| `slicer_id` | text | which slicer plugin owns it (`"orca"`) |
| `name` | text | operator-facing label |
| `path` | text | bundle dir under `/profiles` (read-only) |
| `gcode_flavor` | text | denormalized for fast capability checks |
| `created_at` | integer | epoch ms |

### printer
A physical device addressable by a transport. **Secrets live here and never leave the server.**

| column | type | notes |
|---|---|---|
| `id` | text PK | `"klipper-garage"` |
| `transport_id` | text | `"moonraker"` \| `"elegoo"` |
| `name` | text | operator label |
| `address` | text | host:port / mqtt topic / serial |
| `secrets_json` | text (encrypted-at-rest) | API keys/tokens; resolved server-side only |
| `created_at` | integer | epoch ms |

### station
The only thing end users pick. Binds a printer to a slicer+profile (see `PLUGINS.md`).

| column | type | notes |
|---|---|---|
| `id` | text PK | `"garage-klipper-pla"` |
| `name` | text | `"Garage Klipper — PLA 0.2mm"` |
| `transport_id` | text | FK → printer.transport_id |
| `printer_id` | text | FK → printer.id |
| `slicer_id` | text | FK → profile.slicer_id |
| `profile_id` | text | FK → profile.id |
| `allowed_generators_json` | text null | optional allowlist; null = all |
| `created_at` | integer | epoch ms |

> **Invariant** (enforced by `validateJob`, ADR/SEQUENCE): a Station is only valid if
> `profile.slicer_id == station.slicer_id` and `profile.gcode_flavor ∈ transport.acceptsFlavors`.
> Validated at Station-create time (in Settings) *and* pre-flight at job submit.

### job
Durable history of a pipeline run. Live state is in Redis; this is the settled record.

| column | type | notes |
|---|---|---|
| `id` | text PK | uuid (matches BullMQ job id + `/data/<id>/`) |
| `generator_id` | text | `"gridfinity"` |
| `params_json` | text | validated generator params (the user's config) |
| `station_id` | text | FK → station.id (resolves slicer/profile/printer) |
| `state` | text | terminal: `done` \| `failed` \| `canceled` (live states transient in Redis) |
| `stage` | text null | stage at failure, if any |
| `error_json` | text null | `{ stage, reason }` on failure |
| `model_path` | text null | `/data/<id>/model.stl` |
| `gcode_path` | text null | `/data/<id>/model.gcode` |
| `created_at` | integer | epoch ms |
| `updated_at` | integer | epoch ms |

## Lifecycle ↔ storage

| Moment | Redis | SQLite | FS |
|---|---|---|---|
| submit | enqueue + initial snapshot | — | mkdir `/data/<id>` |
| generating/slicing/transferring/printing | snapshot + publish each transition | — | write `model.stl`, `model.gcode` |
| terminal (done/failed/canceled) | final snapshot (TTL-expire later) | **insert/append `jobs` row** | keep gcode; cleanup on failure |
| operator edits station/printer/profile | — | upsert | — |

## Redis keys (single source of truth in `shared/events.ts`)

- `conveyor:jobs` — BullMQ queue
- `job:<id>` — latest `JobStatusEvent` snapshot (reconnect-safe `GET /jobs/:id`)
- `job:<id>:status` — pub/sub channel the API bridges to the WS
- `job:<id>:control` — cancel signal (API → worker)

## Secrets

Printer credentials live only in `printer.secrets_json` (encrypted at rest), are read solely by
the worker's transport adapter, and are **never** included in any API response. The PWA only ever
knows a `stationId`. (Friends-only deployment; app-level auth is an open decision in `SPEC.md`.)

## Retention

- Artifacts: keep last N successful jobs' gcode (configurable); prune older. Failed-job dirs are
  cleaned immediately by the worker.
- `jobs` rows: keep indefinitely (small); they're the print history the PWA can list.
- Redis snapshots: short TTL after terminal — SQLite is the durable record.

## Implementation status

**SQLite store SHIPPED (2026-06-29).** Backed by `bun:sqlite` (synchronous, no native build — same
on aarch64/x86_64). One module, `@conveyor/shared/db`, owns the schema + queries; both `api`
(`stations-store.ts`) and `worker` (`stations.ts`) delegate to it, so there is one source of truth.
The DB is opened on the shared `/data` volume (`DB_PATH`, default `/data/conveyor.db`) and the
default catalog (the old in-memory seeds) is seeded only when the `stations` table is empty, so
edits made in Settings survive restarts. The worker resolves real `PrinterTarget`s (incl. secrets)
from `printers` and writes the settled `Job` row on every terminal state.

Catalog CRUD lives behind `/catalog/*` (stations/printers/profiles) + `/jobs-history`; printer
secrets are accepted on write but **stripped on read** (only a `hasSecrets` flag is returned). New
Stations are capability-validated (`validateStation`) before persist. Both surfaces are gated by
`registerAuthGuard` when `CONVEYOR_PASSWORD` is set, and open when it is not — there is a single
access tier, so holding the password grants the catalog too.

Full catalog + history surface (2026-09-02):

| Route | Notes |
| --- | --- |
| `GET/PUT /catalog/stations`, `DELETE /catalog/stations/:id` | `validateStation` on write |
| `GET/PUT /catalog/printers`, `DELETE /catalog/printers/:id` | `transportId` validated against the registry; secrets stripped on read |
| `GET/PUT /catalog/profiles`, `DELETE /catalog/profiles/:id` | |
| `GET /catalog/transports` | capability metadata; drives the Settings printer form's picker |
| `GET /jobs-history?limit=` | windowed list, default 50, max 200 |
| `GET /jobs-history/:id` | one settled job; 404 when absent |

Two integrity rules are enforced in the API rather than the database:

- **Deleting a printer or profile a Station references is refused with 409**, naming the blocking
  Stations. The `stations` table declares no foreign keys (`PRAGMA foreign_key_list(stations)` is
  empty even though `PRAGMA foreign_keys` is ON), so SQLite would otherwise delete the row and
  leave the Station pointing at nothing — visibly fine in Settings, failing only later at submit.
- **A printer upsert that omits `secrets` keeps the stored value** (`COALESCE` in
  `dbUpsertPrinter`). Reads strip secrets, so a client editing a printer cannot round-trip them;
  assigning the incoming value directly used to wipe the credential on any address-only edit.
  Pass `secrets: {}` to clear deliberately.

Only **terminal** jobs get a `jobs` row (the worker calls `recordTerminal` on done/failed), so
`/jobs-history` never contains a job in flight. That is why the PWA keeps a per-browser
localStorage strip on `/history` alongside the durable table, and why a running job links to the
home page's live panel (`/?job=<id>`) instead of `/history/<id>`.

> The page routes (`/`, `/settings`, `/history`, `/history/<jobId>`) deliberately share **no prefix**
> with any API namespace. A page at `/admin` or `/jobs` 404s on direct load, because the proxy and
> Caddy forward those whole prefixes to the API. Note `/history` (page) vs `/jobs-history` (API) are
> distinct on purpose. Both the vite proxy and Caddy match API namespaces by **prefix**, so
> sub-paths like `/jobs-history/:id` and `/catalog/printers/:id` need no routing change.
