# Conveyor — Data Model & Storage

What Conveyor persists, where, and why. Two stores with a clean split of duties.

## Storage choice

| Store | Holds | Why |
|---|---|---|
| **SQLite** (file on the `/data` volume) | Durable config + job history: `printers`, `profiles`, `jobs` | Self-hosted single-node app; a file DB needs no extra service, backs up by copying one file, and is plenty fast for this scale. |
| **Redis** (default queue, `CONVEYOR_QUEUE=redis`) | Live job state + status pub/sub (BullMQ queue, `job:<id>` snapshot, `job:<id>:status` channel) | Ephemeral, high-churn, fan-out to many WS clients. Already present for the queue. Not used for jobs in SQLite mode. |
| **Filesystem** (`/data/<jobId>/`) | Artifacts: `model.stl`, `model.gcode` | Large binaries don't belong in a DB; stages pass `{path}` handles (ADR 0001). |
| **`/profiles/*`** (read-only mount) | Bundled slicer profile **defaults** (Orca machine/filament/process JSON) | Curated by the operator, version-controlled outside the app, mounted read-only. These are the *defaults* and the reset target; a user's edits live in SQLite (below), never on this mount. |

**Rule of thumb, Redis mode (the default):** Redis is the *live* truth for an in-flight job; SQLite is
the *durable* truth for config and finished jobs. On a terminal state the worker writes the final `Job`
row to SQLite; the Redis `job:<id>` snapshot is written with a plain `SET` and no TTL, so it stays until
something deletes it.

**SQLite mode** (`CONVEYOR_QUEUE=sqlite` plus `CONVEYOR_QUEUE_UNSTABLE=1`): the `jobs` row is inserted at
enqueue and is the one truth for queue state, live status and history; live events go to `job_events`.
See [design/sqlite-queue.md](design/sqlite-queue.md).

## Entities

```
printers ──< jobs >── profiles
```

A job names one printer and one profile. Nothing joins them ahead of time: the
transport comes from the printer and the slicer + g-code flavour from the profile, so
the pair is the whole print configuration.

### profile
A slicer configuration bundle. Rows are a catalog over the `/profiles` mount, with
optional per-profile edited JSON overriding the bundled files.

| column | type | notes |
|---|---|---|
| `id` | text PK | `"orca/klipper-pla-0.2"` |
| `slicer_id` | text | which slicer plugin owns it (`"orca"`) |
| `name` | text | operator-facing label |
| `path` | text | bundle dir under `/profiles` (read-only defaults / reset target) |
| `gcode_flavor` | text | denormalized for fast capability checks |
| `orca_machine_json` | text null | edited Orca machine JSON; `NULL` = use the bundled file |
| `orca_process_json` | text null | edited Orca process JSON; `NULL` = use the bundled file |
| `orca_filament_json` | text null | edited Orca filament JSON; `NULL` = use the bundled file |
| `prusa_ini` | text null | edited PrusaSlicer `config.ini`; `NULL` = use the bundled file |
| `created_at` | integer | epoch ms |

> **Source semantics — bundled vs edited.** For each of the three Orca documents,
> `NULL` means "fall back to the bundled `/profiles` file"; a non-NULL value is the
> operator's edit and takes precedence at slice time. The three columns move together:
> `dbGetOrcaProfileDocuments` returns `null` when all three are NULL (a pristine
> bundled profile) and throws on a partial set (a would-be half-edited profile is never
> valid). A Prusa profile's edit is the single `prusa_ini` column, served and saved as the
> `prusa-ini` format. The content routes answer 409 when:
>
> - the profile's slicer has no raw-edit format (`GET`, `PUT` and `DELETE`);
> - the profile's `path` is not a valid bundled `/profiles/<bundle>` path;
> - the path, or a bundled file in it, resolves outside the profile root (a symlink escape);
> - a bundled file is not a regular file;
> - `GET` reads an unedited Orca profile whose bundled files fail validation (`bundled …`).
>
> A missing bundle directory or file is 404 (`packages/api/src/profile-content.ts`).
>
> **Routes** (`packages/api/src/routes/catalog-content.ts`):
> `GET /catalog/profiles/:id/content` returns the effective documents plus a per-document
> source badge (`bundled` | `edited`); `PUT` saves an edit (server-validated); `DELETE`
> resets to bundled (validates the bundled files before clearing the override, so a reset
> never lands on an unslice-able bundle). The bundled-file reader
> (`packages/api/src/profile-content.ts`) canonicalizes and containment-checks the path
> under `CONVEYOR_PROFILES_ROOT` and only reads the three allowlisted filenames — no
> request-supplied path ever reaches the filesystem.
>
> **Limits** (`packages/shared/src/profile.ts`): each document ≤ 256 KiB
> (`MAX_ORCA_DOCUMENT_BYTES`), the three combined ≤ 768 KiB (`MAX_ORCA_CONTENT_BYTES`);
> each must parse as a JSON object. `validateOrcaProfileDocuments` is the single shared
> validator — the API save path and the worker both call it, so the client's `JSON.parse`
> is a UX nicety, never the gate.
>
> **Materialization** (`packages/worker/src/profile.ts`): when a job names an edited
> profile, `resolveProfileForSlice` writes the three documents into a per-job
> `<workDir>/profile/` dir (dir `0700`, files `0600`, fixed filenames, `flag:"wx"`) and
> hands the slicer that path, cleaning it up in a `finally`. An edited Prusa profile is
> materialized the same way from `prusa_ini`. A pristine profile keeps its bundled `path` unchanged.
>
> **Backup.** Edits live in SQLite, so they are captured by a DB file backup; the
> `/profiles` mount is immutable and needs no separate backup beyond its version control.

### printer
A physical device addressable by a transport. **Secrets live here and never leave the server.**

| column | type | notes |
|---|---|---|
| `id` | text PK | `"klipper-garage"` |
| `transport_id` | text | `"moonraker"` \| `"elegoo"` |
| `name` | text | operator label |
| `address` | text | host:port / mqtt topic / serial |
| `secrets_json` | text null | API keys/tokens as an AES-256-GCM envelope, `v1:<iv>:<tag>:<ciphertext>` (base64 parts); decrypted only by the worker |
| `allowed_generators_json` | text null | JSON array of generator ids this printer accepts. **NULL = unrestricted**, `[]` = accepts nothing |
| `created_at` | integer | epoch ms |
| `hold_job_id`, `hold_reason`, `hold_at` | text / text / integer, null | SQLite mode only: a [printer hold](design/sqlite-queue.md#printer-holds) after an outcome the queue cannot know |
| `last_seen_at`, `last_checked_at` | integer null | epoch ms the printer last answered, and the last time anything tried it. Returned as `lastSeenAt` and `lastCheckedAt`, absent until the first check. Written by `dbRecordPrinterCheck`, which never moves either time back |

> `allowed_generators_json` is returned to clients (it is policy, not a secret), so a
> form can round-trip it — which is why `dbUpsertPrinter` assigns it directly while
> keeping the stored `secrets_json` when `secrets` is omitted. Omitting it on write means "no restriction"; COALESCE
> would have made an allowlist impossible to remove. The `NULL` vs `[]` distinction is
> load-bearing at every layer: `?? undefined` (not `|| undefined`) when reading the row,
> presence-not-truthiness when checking it, and an explicit toggle in the Settings form
> so a user can see which state they are in.

> **Removed 2026-09-02: the `stations` table.** A Station was an operator-curated,
> named binding of a printer to a slicer + profile, and it was the only thing end users
> picked. It was always *fully derivable* from `(printer_id, profile_id)` — the
> transport is `printer.transport_id` and the slicer is `profile.slicer_id` — so it
> bought a catalog object to curate and nothing else. Jobs now name the pair directly.
> The migration in `openDb()` rebuilds `jobs` with `printer_id`/`profile_id` backfilled
> from the station each job used, then drops the table.
>
> **Deploy `api` and `worker` together for this one.** The migration is not
> backward-compatible with a pre-change worker: once any process has migrated the file,
> an old worker still writing `station_id` fails the job outright (measured:
> `no such table: stations`, surfaced as a `generator`-stage error, with the history
> write failing too so the run leaves no durable row). Rolling one image at a time
> breaks every job that lands on the stale one. Note also that `openDb()` is **lazy** —
> the migration runs on first database *use*, not at boot — so a restarted service may
> still show the old shape until it serves its first request.

> **Invariant** (enforced pre-flight by `validateJob` at job submit): a
> (printer, profile) pair is printable only if the slicer named by
> `profile.slicer_id` offers `profile.id`, the generator's outputs intersect that
> slicer's accepted inputs, and `profile.gcode_flavor ∈ transport.acceptsFlavors` for
> the transport named by `printer.transport_id`. The PWA filters the profile picker by
> that last rule so an unprintable pair is never offered.
>
> Separately, `printer.allowed_generators_json` is a **policy** refusal rather than an
> incompatibility — the pair may slice perfectly and still be disallowed — so it is
> checked first and reported distinctly (`printer X does not allow generator Y`). The
> PWA hides printers whose allowlist excludes the chosen generator, and the Upload STL
> tab submits `passthrough`, so an allowlist can restrict uploads too.

### job
A pipeline run. In Redis mode this is the settled record, written once at the end. In SQLite mode the
row is inserted at enqueue and carries the job through its whole life.

| column | type | notes |
|---|---|---|
| `id` | text PK | uuid (matches BullMQ job id + `/data/<id>/`) |
| `generator_id` | text | `"gridfinity"` |
| `params_json` | text | validated generator params (the user's config) |
| `printer_id` | text null | printer used → its transport. Null/`""` when unrecoverable (see migration note) |
| `profile_id` | text null | profile used → its slicer + g-code flavour |
| `state` | text | a `JobState`. Redis mode writes only terminal ones: `done` \| `failed` \| `canceled`. SQLite mode also stores `queued` through `printing` |
| `stage` | text null | stage at failure, if any |
| `error_json` | text null | `{ stage, reason }` on failure |
| `model_path` | text null | `/data/<id>/model.stl` |
| `gcode_path` | text null | `/data/<id>/model.gcode` |
| `timings_json` | text null | when each stage was entered and how long it took (`StageTiming[]`) |
| `notes` | text null | non-fatal notes from the run, such as a work file that could not be removed |
| `created_at` | integer | epoch ms |
| `updated_at` | integer | epoch ms |
| `progress`, `message` | real / text, null | SQLite mode: the live status |
| `attempts`, `max_attempts`, `run_after` | integer | SQLite mode: retries and backoff |
| `lease_owner`, `lease_token`, `lease_until` | text / integer / integer | SQLite mode: the fenced lease |
| `cancel_requested_at` | integer null | SQLite mode: the cancel flag |
| `submit_started_at`, `submitted_at`, `print_handle_json` | integer / integer / text, null | SQLite mode: the submit intent, the marker and the handle a resume reads |

The SQLite-mode columns, their defaults and the `job_events` table are explained in the queue design's
[Schema](design/sqlite-queue.md#schema). On a database from before the queue they keep their defaults, so old
rows stay inert history.

### job_events (SQLite mode)

| column | type | notes |
|---|---|---|
| `seq` | integer PK autoincrement | the cursor a WebSocket tail reads from |
| `job_id` | text | the job |
| `event` | text | a serialized `JobStatusEvent`, the frame the WebSocket sends |
| `at` | integer | epoch ms |

A `printing` event can carry `print: { layer?, layers?, secondsLeft? }` (`PrintProgress` in
`packages/shared/src/events.ts`): the current layer, the layer count and the printer's seconds left, each
only when the printer reports it. It lives only in the event: the `jobs` row has no column for it, so in
SQLite mode `GET /jobs/:id` leaves it out and a client gets it from the next tailed event. In Redis mode the
`job:<id>` snapshot is the whole last event and keeps it.

### sessions

| column | type | notes |
|---|---|---|
| `id` | text PK | the `sid` claim of a session cookie |
| `expires_at` | integer | epoch ms, the cookie's `exp` |
| `password_version` | text | HMAC of the password the session was issued under, keyed by the signing secret; a session whose value no longer matches is refused |

A row exists for every live login. Logout deletes it, and a login prunes the expired ones. See `docs/modules/api.md` § Auth.

Indexes: `idx_jobs_created_at` (history), `idx_jobs_claim`, `idx_jobs_lease` and the partial
`idx_jobs_printer_live` (the queue), and `idx_job_events_job`. The schema itself is in
`packages/shared/src/db/schema.sql.ts` and `db/migrate.ts`.

## Lifecycle ↔ storage

| Moment | Redis | SQLite | FS |
|---|---|---|---|
| submit | enqueue + initial snapshot | — | mkdir `/data/<id>` |
| generating/slicing/transferring/printing | snapshot + publish each transition | — | write `model.stl`, `model.gcode` |
| terminal (done/failed/canceled) | final snapshot (no TTL) | **insert/append `jobs` row** | keep gcode; cleanup on failure |
| operator edits printer/profile | — | upsert | — |

In SQLite mode the Redis column is empty: submit inserts the `jobs` row, every transition updates it and
appends a `job_events` row, and the terminal write settles the same row. A worker prunes `job_events` of jobs
settled more than 7 days ago; the `jobs` row stays.

## Redis keys (Redis mode; in `shared/src/events.ts` and `shared/src/status.ts`)

- `conveyor-jobs` — BullMQ queue (BullMQ forbids `:` in a queue name)
- `job:<id>` — latest `JobStatusEvent` snapshot (reconnect-safe `GET /jobs/:id`)
- `job:<id>:status` — pub/sub channel the API bridges to the WS
- `job:<id>:control` — cancel signal, fast path (API → worker)
- `jobs:active` — set of in-flight job ids. It is updated in the same Lua script (`PUBLISH_STATUS_SCRIPT`) as the snapshot, so the set and the snapshot always agree on whether a job is live.
- `job:<id>:cancel` — durable cancel flag with a 7-day TTL, checked by the worker on start and between stages

## Secrets

Printer credentials live only in `printer.secrets_json`, encrypted with AES-256-GCM since
[#162](https://github.com/OnlyOneByte/Conveyor/issues/162)
(`packages/shared/src/secrets/`). Each write uses a fresh random 12-byte IV and stores the 16-byte
auth tag; the printer id is bound in as associated data, so a value copied to another row does not
decrypt. The `v1:` prefix names the envelope format so a later key or cipher can be rotated in.

- **Key.** `CONVEYOR_SECRETS_KEY` (32 bytes, canonical base64) when set; otherwise `secrets.key` next
  to the database, generated once with mode `0600`. `openDb` refuses a malformed key and never logs it.
- **Migration.** On first open, one `BEGIN IMMEDIATE` transaction encrypts every plaintext row and
  stores an encrypted key check in `meta.secrets_key_check`. After that, plaintext is refused on read
  and `openDb` refuses a different key.
- **Who decrypts.** Only the worker, in `resolvePrinterTarget`, right before a transport call. The api
  encrypts on write and reports `hasSecrets` (the column is non-null); no API response carries secrets.

This protects copies of `conveyor.db` and its backups. It does not protect against anyone who can read
both the database and the key.

## Retention

- Artifacts: a done job's `/data/<id>/` is kept, and nothing prunes it yet, so disk use grows with every
  print (#9). A failed or canceled job's directory is removed when it settles (`worker/src/settle.ts`).
- `jobs` rows: keep indefinitely (small); they're the print history the PWA can list.
- `job_events` (SQLite mode): pruned 7 days after the job settles (`EVENT_RETENTION_MS`).
- Redis snapshots: no TTL today; they stay until deleted. SQLite is the durable record.

## Implementation status

**SQLite store SHIPPED (2026-06-29).** Backed by `bun:sqlite` (synchronous, no native build — same
on aarch64/x86_64). One module, `@conveyor/shared/db`, owns the schema + queries; both `api`
and `worker` delegate to it, so there is one source of truth.
The DB is opened on the shared `/data` volume (`DB_PATH`, default `/data/conveyor.db`) and the
default catalog (the old in-memory seeds) is seeded once per database, so edits made in Settings
survive restarts. The flag is the row `key = 'seeded'` in a small `meta (key, value)` table that
`migrate()` creates; `PRAGMA user_version` is left free for a future schema version. The check,
the flag write and the inserts run in one `BEGIN IMMEDIATE` transaction, so a crash mid-seed
leaves the database unseeded and concurrent first starts seed exactly once. A database that
predates the flag is marked seeded without inserting anything when it already holds any printer
or profile. Zero printers (and zero profiles) is a valid state: deleting every row survives
restarts, `/catalog/printers` returns `[]`, and `POST /jobs` naming a missing printer is rejected
with 404.

Every connection sets `PRAGMA busy_timeout = 5000` before anything else, because the API and the
worker open the same file and their first starts can race on a fresh volume. SQLite does not apply
the busy handler to the switch into WAL on a brand-new file, so `openDb()` makes up to 50 attempts
at `PRAGMA journal_mode = WAL`, 100 ms apart, retrying only on `SQLITE_BUSY`. Any other error is
rethrown at once. After the 50th busy attempt it throws `could not enable WAL on <path> after 50
attempts: database is locked`, with the SQLite error as its `cause`. The worker resolves real
`PrinterTarget`s (incl. secrets) from `printers` and writes the settled `Job` row on every
terminal state.

Catalog CRUD lives behind `/catalog/*` (printers/profiles/transports) + `/jobs-history`; printer
secrets are accepted on write but **stripped on read** (only a `hasSecrets` flag is returned).
A printer's `transportId` is validated against the registry before persist. Both surfaces are gated by
`registerAuthGuard`, which is on by default and off only under an explicit `CONVEYOR_AUTH=disabled` — there is a single
access tier, so holding the password grants the catalog too.

Full catalog + history surface (2026-09-02):

| Route | Notes |
| --- | --- |
| `GET/PUT /catalog/printers`, `DELETE /catalog/printers/:id` | `PUT` checks `transportId` and every `allowedGenerators` id against the registry; `secrets` holds at most 16 entries, names 1–64 characters, values up to 4096 (`catalog-validation.ts`). Secrets are stripped on read |
| `GET/PUT /catalog/profiles`, `DELETE /catalog/profiles/:id` | `PUT` checks `slicerId` against the registry, needs a `gcodeFlavor` some registered transport accepts, and a `path` of the form `/profiles/<bundle>` |
| `GET /catalog/transports` | capability metadata; drives the Settings printer form's picker |
| `GET /jobs-history?limit=` | windowed list, default 50, max 200 |
| `GET /jobs-history/:id` | one settled job; 404 when absent |

One integrity rule is enforced in the API rather than the database:

- **A printer upsert that omits `secrets` keeps the stored value** (`dbUpsertPrinter`). Reads strip secrets, so a client editing a printer cannot round-trip them;
  assigning the incoming value directly used to wipe the credential on any address-only edit.
  Pass `secrets: {}` to clear deliberately.

Deleting a printer or profile is refused only while it is still needed:

- `404` for an unknown id.
- `409` while a **queued or running** job names it, because the worker would fail that job
  with `unknown printer`. On the SQLite queue that is any `jobs` row not done, failed or
  canceled; on the Redis queue, any BullMQ job that is waiting, active, delayed,
  prioritized or waiting-children. BullMQ 6 has no separate paused state: a job in a paused
  queue counts as waiting.
- `409` for a bundled profile (the seeded `DEFAULT_PROFILES`), whatever references it.

The in-use check and the delete are not one atomic step. On the Redis queue the check is a
snapshot of BullMQ (`getJobs`), so a job enqueued after the snapshot and before the row is
deleted slips through. That is an accepted risk: such a job fails at its first step with
`unknown printer` (or the profile equivalent), which is the behaviour every job had before
this check existed. On the SQLite queue the same window is the time between two statements
in one process.

Finished jobs never block a delete. A finished job's `printer_id`/`profile_id` record what it
printed with, which is history rather than a live reference: deleting a printer today must
not rewrite what ran last week. The history shows an id that no longer resolves as-is, and an
empty one as `—`, instead of hiding the row.

Only settled jobs appear in `/jobs-history`, in both modes. In Redis mode those are the only rows; in
SQLite mode a live job has a row from enqueue, but the list filters on `done`/`failed`/`canceled` and
`/jobs-history/:id` answers 404 until it settles. That is why the PWA keeps a per-browser
localStorage strip on `/history` alongside the durable table, and why a running job links to the
home page's live panel (`/?job=<id>`) instead of `/history/<id>`.

> The page routes (`/`, `/settings`, `/history`, `/history/<jobId>`) deliberately share **no prefix**
> with any API namespace. A page at `/admin` or `/jobs` 404s on direct load, because the proxy and
> Caddy forward those whole prefixes to the API. Note `/history` (page) vs `/jobs-history` (API) are
> distinct on purpose. Both the vite proxy and Caddy match API namespaces by **prefix**, so
> sub-paths like `/jobs-history/:id` and `/catalog/printers/:id` need no routing change.
