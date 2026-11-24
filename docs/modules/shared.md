# packages/shared

Domain types, plugin contracts, profile validation and SQLite access shared by `api`, `worker`, `web` and
the plugins. Code in this package carries no comments; the reasons behind it live here, one section per
module.

## address.ts

Printer address parsing, imported as `@conveyor/shared/address`. It uses `node:net`, so it's a subpath of its
own and stays out of the root export that `web` bundles. The api probe and the transport plugins all use
it.

- `parseHostPort(address, defaultPort, shown?)` never throws. It returns `{ kind: "parsed", host, port }` or
  `{ kind: "invalid", reason }`.
- `shown` is the full address `address` was cut from, when a caller parses only part of it (Moonraker parses
  the host before a path). Reasons quote `shown`, redacted, instead of the part, so a password that sits
  outside the part can't leak.
- Accepted forms:
  - a URL, `http(s)://host:port/path`, including `http://[fe80::1]:7125/`;
  - an IPv4 address or hostname, with or without `:port`;
  - a bracketed IPv6 address, with or without `:port` (`[fe80::1]:3030`, `[fe80::1]`);
  - a bare IPv6 address (`fe80::1`).
- A bare IPv6 address never carries a port: `fe80::1:3030` is the IPv6 address `fe80::1:3030`, so a port
  needs brackets.
- Hostnames:
  - labels may use `_` (`voron_2.local`, `_printer`), as mDNS and some routers' DHCP names do;
  - one trailing dot is allowed and kept (`printer.local.`), since an absolute DNS name resolves the same.
- Ports: every form, URLs included, takes only 1–65535. Without a port, an `https` URL uses 443 and anything
  else uses `defaultPort`. IPv6 hosts come back without brackets.
- `invalid` covers:
  - an empty address;
  - more than one colon without brackets that isn't a valid IPv6 address (`fe80::1::2`, `10.0.0.5:3030:1`);
  - brackets that don't hold an IPv6 address (`[10.0.0.5]:3030`);
  - an IPv6 zone ID, bare or bracketed (`fe80::1%eth0`, `[fe80::1%eth0]:7125`), because no WHATWG URL can
    hold one, so every transport URL built from it would fail;
  - a port outside 1–65535, or one that isn't a number;
  - a dotted number that isn't IPv4 (`10.0.0.256`);
  - a host with characters a hostname can't have;
  - a URL that doesn't parse.
- An address, or `shown`, with a control character or line break (Unicode `Cc`) inside it is rejected
  with "the address contains a control character or line break". Both are trimmed first, so a trailing
  newline or a leading tab is accepted, as it was before.
- The reason quotes the address and says what to change. Everything before the last
  `@`, across line breaks too, becomes `***`, keeping only a leading `scheme://` or `//`:
  - `http://admin:s3cret@[bad/` is quoted as `http://***@[bad/`;
  - `admin:s3cret@printer` is quoted as `***@printer`.

  So a `user:password@` never reaches a reason, with or without a scheme. The URL parser's own message isn't
  quoted, because it can contain the raw text.
- `formatHostPort(host, port)` brackets a host that contains `:`, so `fe80::1` and 3030 give
  `[fe80::1]:3030`. Transports build every URL from it.

## artifacts.ts

An `Artifact` is a file on the shared `/data` volume that one stage hands to the next.

- `path` is absolute and lies under `/data`.
- `format` is the file kind: `stl`, `3mf`, `obj`, `gcode` and so on.
- `ModelArtifact` is what a generator emits and a slicer reads. `GcodeArtifact` is what a slicer emits and a
  transport reads. Both are plain aliases of `Artifact` today.

## context.ts

`StageCtx` is the per-job context the worker hands to every stage.

- `workDir` is the job's absolute working directory under `/data`.
- `report(progress, message)` takes progress from 0 to 1 within the current stage and surfaces it as a
  status event, which goes to the Redis status bus or the SQLite `job_events` log depending on the queue mode
  (see [events.ts](#eventsts)).
- `reportUpload(bytesSent, bytesTotal)` is optional and only transports call it. The worker publishes it as a
  `transferring` event with `bytesSent`, `bytesTotal` and `progress = bytesSent / bytesTotal` (1 for an empty
  file). `parseStatusEvent` takes both counts only as whole, non-negative numbers; old events without them
  still parse.
- `signal` is cooperative cancellation. Adapters pass it to every spawned engine and every `fetch`.

`StageError` is the typed failure a stage adapter throws. It records which stage failed and why, and its
message reads `[stage] reason`.

## events.ts

`JobStatusEvent` is one status update for a job. The API forwards it verbatim to the WebSocket, and the PWA is
a pure projection of these events. How it travels depends on the queue mode ([queue-mode.ts](#queue-modets)):

- **Redis** (the default): the worker's `publishStatus` writes it as the job's snapshot and publishes it on
  the job's pub/sub channel in one Lua script ([status.ts](#statusts)).
- **SQLite**: the worker's `writeStatus` updates the `jobs` row and appends the event to the `job_events` log
  in one transaction, and the API tails that log ([queue/status.ts](#queuestatusts-and-queueevent-logts)).

Both stamp `seq`, the event's position in that job's stream: a per-job counter on Redis, the `job_events` row
id on SQLite. A WebSocket sends the snapshot, then only events with a higher `seq`, so none is missed or
repeated.

- `progress` runs from 0 to 1 within the current stage.
- `timings` is the per-stage wall clock so far, with the last stage left open while it runs. Live events
  carry it once the worker has entered its first stage, so a monitoring view can show "3m in slicing"
  without waiting for the job to settle.
- `at` is epoch milliseconds.

`JOB_QUEUE` is the BullMQ queue name shared by the API (producer) and the worker (consumer). BullMQ forbids
`:` in queue names, so it uses a hyphen.

The names below are Redis-mode only. `jobChannel` and `jobSnapshotKey` are the single source of truth for the
pub/sub channel and snapshot key on both ends.

`ACTIVE_JOBS_KEY` names a Redis set of the job ids in flight. The worker adds an id when it starts a job and
removes it on any terminal state. The API reads the set, then each job's snapshot, to answer
`GET /jobs/active` without scanning keys. A set keeps the read O(active jobs), and a stale id simply
resolves to a terminal snapshot that the API filters out.

## exhaustive.ts

`exhaustive(value: never): never` closes every `switch` or `if` chain over a union. Each member gets its own
branch and the default calls `exhaustive(value)`, so a new member is a type error at every chain that misses
it. A value outside the union that still reaches it at runtime (a plugin yielding an unknown state) throws
`unhandled value: <value>`.

## job-view.ts

`GET /jobs/active` and `GET /jobs/:id` answer a `JobView`: the status snapshot plus `printerId`, `profileId`,
`generator` and `createdAt` (#342). `jobFieldsSchema` checks those four, reusing `jobRequestSchema`'s generator
shape. `jobView(snapshot, fields)` merges them only when all four pass, and reports `complete: false`
otherwise, so both queue modes leave out a bad request the same way instead of serving a partial one. The
schema strips unknown keys, so request data can never overwrite the snapshot's own `jobId` or `state`.

## job.ts

`JobRequest` is what the PWA submits: a generator (with optional params, since a generator may take none),
a printer and a profile. Nothing else is needed, because the printer determines the transport and the
profile determines the slicer and the g-code flavour. This used to be a single `stationId`, a saved
(printer, profile) pairing; the pairing was always derivable from the two ids, so the extra catalog object
was removed.

`jobRequestSchema` is the zod schema for that shape, and `JobRequest` is inferred from it
(`z.infer<typeof jobRequestSchema>`), so the type and the check cannot drift. It is parsed at both edges a
request crosses: `POST /jobs` parses the HTTP body, and the worker parses the queued BullMQ payload before
running the pipeline.

`JobTarget` is a job's print target with everything resolved: the printer and profile the request named,
plus what they imply. The API and the worker build it from the catalog and hand it to `validateJob()`.

| Field | Comes from |
|---|---|
| `transportId` | the printer row |
| `profileName` | the profile row; passed to the slicer adapter at runtime |
| `profilePath` | the profile row; a bundled path today, a per-job materialized directory later |
| `slicerId` | the profile row |
| `gcodeFlavor` | the profile row: the flavour this profile emits |
| `allowedGenerators` | the printer row: `undefined` means no restriction, `[]` permits nothing |

`Job` is the durable record, persisted to SQLite on a terminal state. `timings` is captured as the worker
enters each stage. `error` is set only when a job failed. `notes` holds what went wrong around a job that did
not fail (a work dir that could not be removed, a status stream that did not close cleanly), so a canceled
or finished job never shows an error line.

`StageTiming` is one stage's wall-clock span. `enteredAt` (epoch ms) is stamped when the worker begins the
stage. `durationMs` is filled once the next stage starts or the job settles, so an in-flight stage has
`enteredAt` set and `durationMs` undefined.

`computeStageTimings(enters, settledAt)` folds an ordered list of stage-enter timestamps into
`StageTiming`s. `settledAt` closes the final stage for a terminal job; omit it to leave the last stage open.
The input must be in entry order, which is how the worker records it.

## plugins.ts

The three stage contracts (`GeneratorPlugin`, `SlicerPlugin`, `TransportPlugin`) and the shapes they
exchange. [../PLUGINS.md](../PLUGINS.md) is the contract page: every interface, field by field, including
the form presentation hints.

## registry.ts

`Registry` is the startup-populated map of available plugins per stage.

`validateJob(request, target, registry)` is the pre-flight check the API runs before enqueueing. It throws
`CompatibilityError` when the resolved generator → slicer → transport chain cannot interoperate, so an
incompatible combination fails fast with a 4xx instead of dying mid-pipeline. The checks, in order:

1. The generator exists.
2. The printer's generator allowlist admits it. This runs before the capability checks because it is a
   policy refusal, not an incompatibility: the pair might slice fine and still be disallowed. `undefined`
   means unrestricted while `[]` allows nothing, so the test is on presence, not on the contents.
3. The slicer and the transport exist.
4. `generator.outputs` and `slicer.accepts` intersect.
5. The profile's g-code flavour is in `transport.acceptsFlavors`.

The flavour check uses the profile's `gcodeFlavor`, not the slicer's. A slicer declares one flavour but can
offer profiles emitting others: `prusa` declares `klipper` yet ships `prusa/marlin-pla-0.2`.

A slicer has no profile list to check against. The profile row has already been resolved from SQLite and
its `slicerId` selected the adapter; edited and duplicated runtime profiles are valid without being compiled
into the adapter.

## profile.ts

Editable slicer profile content and its trust-boundary validation. See also
[../SLICER-PROFILES.md](../SLICER-PROFILES.md).

### Orca

An editable Orca profile is three JSON documents: `machine`, `process` and `filament`. Values are raw JSON
text rather than parsed objects on purpose: this is a raw editor, so whitespace and key order survive a
save and reload. The API parses each document to validate it before persistence; the worker writes the
validated text verbatim into a per-job directory before invoking Orca.

`MAX_ORCA_DOCUMENT_BYTES` (256 KiB) is generous relative to the shipped bundle (about 14 KiB in total) and
bounded against denial of service.

`validateOrcaProfileDocuments` is shared validation: the API runs it before persistence and the worker runs
it again before writing files, so a direct database edit cannot bypass it. Text is never normalized;
callers store and materialize the exact validated bytes.

`OrcaEditableProfile` is format-tagged so another slicer's format can be added without weakening the Orca
contract.

### Prusa

A Prusa profile is edited as a single `config.ini` document, kept as raw text for the same reason as Orca:
key order and comments survive a save and reload. `MAX_PRUSA_DOCUMENT_BYTES` is 512 KiB because PrusaSlicer
configs (printer, filament and print in one file) run larger than Orca's.

`validatePrusaProfileContent` (SAX-04, SAX-10) runs in the API before persistence and in the worker before
writing the file. INI is permissive, so the checks are structural rather than a full parse:

- Bounded size.
- No NUL or C0 control bytes other than tab, newline and carriage return. This rejects binary blobs and
  log or CRLF injection while leaving normal INI text, with comments and either line ending, untouched.
- Every non-blank line that is not a `#` or `;` comment or a `[section]` header is a `key = value` setting
  with an allowlisted key. Section headers are optional; PrusaSlicer configs are flat.
- At least one setting, so an empty or junk blob is refused.

PrusaSlicer itself is the arbiter of semantic validity: a parseable but wrong config only surfaces when a
job slices, exactly as for Orca.

### Format routing

`slicerFormat(slicerId)` is the single source of truth for which editable format a slicer's profiles use,
shared by the API (route dispatch), the worker (materialization) and the web client (which editor to open).
A slicer with no editable format returns `null` and is read-only in the editor. Adding a slicer's format
there makes its profiles editable everywhere at once.

## queue-mode.ts

`queueMode(env)` reads `CONVEYOR_QUEUE`: `redis` (the default, also for an empty value) or `sqlite`, and
throws on anything else. `sqlite` also throws unless `CONVEYOR_QUEUE_UNSTABLE=1` is set. The worker and the
api both call it at startup and exit with code 1 on a throw, so they always agree on what a value means.

## status.ts

Status parsing for both queue modes, and the Redis write path.

- `parseStatusEvent(raw)` turns a stored or received JSON string into a `JobStatusEvent`, or `undefined` for
  an empty, unparsable or invalid one; it never throws. The API reads Redis snapshots and pub/sub messages
  with it, and the SQLite queue reads `job_events` rows with it (`tailEvents` throws when it returns `undefined`).
- `status-lite.ts`, exported as `@conveyor/shared/status-lite`, has a `parseStatusEvent` with the same contract
  and no Zod, written as plain type guards. The PWA parses WebSocket frames with it, because anything the layout
  imports loads on every page and Zod is about 31 KB gzip. `status-lite.test.ts` feeds both parsers the same
  valid and invalid events and requires the same result. Its "every field" event must set every key of the
  exported `statusEventSchema`, and of its `print`, `error` and `timings` shapes. So a field added to the schema
  fails that test until it gets a fixture, and the fixture then fails if the lite parser doesn't handle it. The job states it checks come from
  `job-states.ts`, which `job.ts` re-exports. Settings imports `slicerFormat` through `@conveyor/shared/profile`
  for the same reason.
- `publishStatus(client, event)` runs `PUBLISH_STATUS_SCRIPT`, one Lua script, so the snapshot, the
  pub/sub message and the active-jobs set change together. It refuses to overwrite a terminal snapshot and
  returns `false` when it did. Otherwise it stamps the next `seq` from `jobSeqKey`, sets the snapshot,
  publishes it, and adds the id to `ACTIVE_JOBS_KEY`, or removes it on a terminal state.
- Cancel on Redis: the API sets `jobCancelKey` (expiring after `CANCEL_TTL_SECONDS`, 7 days) and publishes
  on `jobControlChannel`; the worker checks the key and listens on the channel.

## slicer-keys.ts and slicer-key-policy.ts

The per-slicer allowlists of profile setting keys. `profile.ts` rejects any key not in `PRUSA_CONFIG_KEYS` or
`ORCA_CONFIG_KEYS`. The lists are generated data, `packages/shared/slicer-keys/*.json`, and `toKeySet`
refuses to load an empty list or an entry that isn't a plain key name or that `DENIED_KEY` matches.

`DENIED_KEY` sits in its own file because `scripts/slicer-keys/generate.ts` filters with the same pattern
when it builds the lists, and importing it from there doesn't load the JSON files it is about to rewrite.
What the lists leave out and how to regenerate them are in [../SLICER-PROFILES.md](../SLICER-PROFILES.md#setting-keys).

## node/ (`@conveyor/shared/node`)

Server-only helpers, kept off the main entry so the web bundle never pulls in `node:` modules:

- `runEngine(stage, cmd, args, ctx)` spawns an engine with the job's `AbortSignal`. A spawn error or a non-zero
  exit rejects with a `StageError` for `stage`, carrying the last 500 characters of stderr. The gridfinity
  generator and both slicers use it. The engine's whole stderr is held in memory until it exits; only the
  error message is capped. That is fine for OpenSCAD and the slicers, which write little to stderr; an engine
  that streams logs there would need a rolling buffer. A zero exit resolves `{ stderr }` with all of it, so
  a caller can explain an exit that produced nothing.
- `requireOutput(stage, path, missing, stderr)` throws a `StageError` for `stage` when `path` is not a file or
  is empty. The reason is `missing`, then ` (the file is empty)` for an empty file, then `: ` and the last 500
  characters of the trimmed stderr when there is any. The cap lives here rather than in each caller, so any
  stderr passed in is bounded. Both slicers call it after a zero exit (#384), because PrusaSlicer 2.9.2 exits 0
  with no G-code when every object is outside the print volume.
- `isWithin(root, candidate)` is the path-containment check the api's artifact download and bundled-profile
  reads use. It refuses `..` escapes and, on Windows, another drive. It only compares strings, so callers
  pass both paths through `realpath` first; an unresolved symlink inside the root would otherwise pass.
- `readFilamentUse(path)` returns the slicer's filament estimate as `FilamentUse` (`{ grams?, metres? }`), or
  `undefined`. `parseFilamentUse(text)` does the parsing:
  - PrusaSlicer 2.9.2 and OrcaSlicer 2.4.1 (the version `install-orca.sh` pins) both write a footer before
    their config block with `; filament used [mm] = …`, `; filament used [g] = …` (one value per extruder,
    comma-separated, summed) and `; total filament used [g] = …`, which wins for grams. OrcaSlicer's header
    block carries no filament totals. The fixtures in `packages/shared/test/fixtures/gcode/` are captured from
    the repo's worker image slicing a 20 × 20 × 10 mm cube with the bundled profiles.
  - A total of 0 is unknown, not zero: a slicer writes `0.00` g when the filament has no density set. The bundled PLA
    profiles (`profiles/*-pla-0.2`) set `filament_density` to 1.24 g/cm³, so default jobs report grams. A
    negative, empty or unreadable value leaves that field out.
  - Only the last 512 KiB is read: the footer sits about 10 KiB (PrusaSlicer) to 20 KiB (OrcaSlicer) from
    the end.

## db/index.ts

Conveyor's durable store, on `bun:sqlite` (synchronous, no native build, the same on aarch64 and x86_64).
The API (config reads, job history) and the worker (print-target resolution, terminal job writes) open the
same file on the shared `/data` volume. `openDb()` is a process-wide singleton, idempotent per path.

`db/index.ts` holds `openDb()` and seeding, and re-exports the queries, which live one table per module:

| Module | Holds |
|---|---|
| `db/printers.ts` | `Printer` and the printer queries |
| `db/profiles.ts` | `Profile` and the profile and profile-content queries |
| `db/sessions.ts` | the `sessions` table behind server-side logout: create (pruning expired rows), check, delete |
| `db/jobs.ts` | `SettledJob`, `dbResolveJobTarget` and the job queries. `dbListJobs` lists finished jobs only (done, failed, canceled), because on the SQLite queue a job has a row from the moment it is queued |
| `db/migrate.ts` | `migrate()`, see [Migrations](#migrations) |

Callers import from `@conveyor/shared/db` only; the module split is not part of the public surface.

### Printers and profiles

`Printer.secrets` is parsed from `secrets_json`, is server-side only and is never serialized to clients.
`Printer.allowedGenerators` is returned to clients so a form can round-trip it. `undefined` means no
restriction, which is deliberately distinct from `[]`, an empty allowlist that permits nothing; a stored
`"[]"` must parse to `[]` and never collapse into "no restriction".
A stored `allowed_generators_json` that isn't a JSON array of strings fails closed. The printer is still
listed, with `allowedGenerators: []` and `unreadable: ["allowedGenerators"]`, so it takes no jobs until it is
saved again, while every other printer works as before. It is logged once per printer per process.
`dbResolveJobTarget` reads the one printer and profile by id, so another printer's bad row can't affect it.
Profile reads select only the columns a `Profile` needs plus one `is_edited` flag, never the stored blobs.

`dbUpsertPrinter` treats the two columns differently, on purpose:

| Column | On update | Why |
|---|---|---|
| `secrets_json` | `COALESCE(new, stored)` | Reads strip secrets, so a client cannot round-trip them. Assigning directly wiped the stored credential whenever someone changed only the address. Omitted keeps what is stored, `{}` clears, `{...}` replaces. |
| `allowed_generators_json` | assigned directly | It is returned on read, so omitting it is a deliberate "no restriction". COALESCE would make an allowlist impossible to remove. |

`Profile.hasEditableContent` is true when the profile has an edit: all three Orca documents, or the Prusa
config, stored in SQLite.

`dbGetOrcaProfileDocuments` returns `null` while the profile still uses its immutable bundled files. A
partial set is an integrity error and throws: save and reset update all three columns in one statement, so
silently mixing database and bundled content would hide corruption and make a slice irreproducible.
`dbSaveOrcaProfileDocuments` and `dbResetOrcaProfileDocuments` replace or clear all three atomically.

The Prusa equivalents work on the single `prusa_ini` column, so there is no partial state. The save and
reset functions return `false` when no such profile exists.

`dbResolveJobTarget(printerId, profileId)` builds a `JobTarget`, deriving the transport from the printer and
the slicer and flavour from the profile. It returns `null` when either id is unknown, so callers answer 400
instead of enqueueing a job that cannot run.

### Jobs

`dbRecordJob` writes the settled record of a finished run, typed as `SettledJob`. A job migrated from a station that had already
been deleted has a null printer and profile; `rowToJob` surfaces them as empty strings rather than invent
values.

`rowToJob` parses `params_json`, `error_json` and `timings_json` one at a time, each checked with a zod schema:
params an object, error `{ stage, reason }`, timings an array of `{ stage, enteredAt, durationMs? }`. A column
that isn't JSON, or is JSON of the wrong shape (`7`, `"boom"`, `{}`), is left out of the job and named in
`unreadable` (`["params"]`, for example), so one corrupt row can't fail
`dbListJobs`, `dbGetJob` or `dbListNeedsYou` for every other job (#400). It logs
`[jobs] job <id> has an unreadable <column> column` once per job and column for the life of the process. The
row is still listed and counted, so a page and `dbCountJobs` keep agreeing, and the history cursor still moves
past it.

`stage` is parsed the same way. A stored stage that isn't `generator`, `slicer` or `transport` becomes
`stage: null` and is named `"stage"` in `unreadable`. `state` is checked against `JOB_STATES`. A job whose
stored state isn't one of them can't be given a state without making one up, so `rowToJob` leaves it out:
`dbGetJob` returns `null` and the lists skip it. It logs `[jobs] job <id> has an unknown state <state>`
once. The list queries name their states in SQL, so only `dbGetJob` can meet one.

`dbGetJob(id)` exists because `dbListJobs()` is windowed (50 rows by default; the API's `/jobs-history`
route in `packages/api/src/routes/catalog.ts` caps a requested limit at 200): a deep link to an older job
would otherwise resolve to "not found" only because it fell off the window.

`retry-claims.ts` holds the two reads the Redis worker's reaper needs ([worker.md](worker.md#redis-reaperts)):
`dbListUnrecordedRetryClaims` lists `retried_by` claims whose retry has no row yet, and `dbRetryOf(retryId)`
finds the failure a retry was claimed for.

### Migrations

`SCHEMA_SQL` is `CREATE TABLE IF NOT EXISTS` only, so it cannot change a table that already exists: a column
added to the DDL is absent from any database created before it, and the first insert naming that column
fails. `migrate()`, in `db/migrate.ts`, reshapes existing tables, each step guarded on the live table
shape and safe on every boot. `openDb` runs it in one `BEGIN IMMEDIATE` transaction, so when the api and the worker
start together the second waits for the first and then sees its columns, instead of failing on a
duplicate `ADD COLUMN` (#8). The waiting process uses the normal
`busy_timeout` of 5 s, and that is enough on purpose. Every step but one is a constant-time `ADD COLUMN`.
The exception, the one-off station rebuild in step 1, copies `jobs` row by row and takes milliseconds at
self-hosted history sizes. If a migration ever did run past 5 s, the waiting process would fail with
`SQLITE_BUSY` and exit, and compose's `restart: unless-stopped` would start it again after the migration
had committed. A longer timeout only for the migration would have to be reset afterwards and could not be
tested without a wait of more than 5 s, so it is not used. A future step that rewrites a large table must
raise `busy_timeout` around the transaction.

1. **`jobs.station_id` → `printer_id` and `profile_id`.** A full table rebuild, because `station_id` was
   `NOT NULL`: adding columns would leave it in place and every later insert would fail. SQLite cannot drop
   a constraint in place, so the rebuild is the supported route. The backfill is lossless, since a station
   was exactly the (printer, profile) pair; a job whose station was already deleted backfills to `NULL`.
   Dropping the old table drops its indexes and triggers, so the rebuild reads every `jobs` index and
   trigger definition first and recreates each one in the same transaction, indexes before triggers;
   `idx_jobs_created_at` never goes missing. A trigger whose SQL names `station_id` or the `stations`
   table, in any case and quoted or not, is not recreated: SQLite checks a trigger body's columns and
   tables only when it fires, and step 7 drops `stations`, so it would fail every later update to
   `jobs`. Its SQL is kept in `meta` under `dropped_trigger:<name>` and `openDb()` warns with that key once
   the migration commits. A station was a (printer, profile) pair, so no single new column can stand in
   for `station_id` in a rewritten body.
2. **`printers.allowed_generators_json`.** Additive and nullable, so `ADD COLUMN`.
3. **`profiles.orca_*_json` and `profiles.prusa_ini`.** Additive and nullable; `NULL` reads the bundled
   files.
4. **`jobs.timings_json`.** Additive and nullable; `NULL` on rows recorded before timings existed.
5. **`jobs.notes`.** Additive and nullable; `NULL` on rows recorded before notes were split from `error`.
6. **The queue columns on `jobs`** (`attempts`, `run_after`, `lease_*`, `cancel_requested_at`,
   `submit_started_at`, `submitted_at`, `print_handle_json`, `progress`, `message`) and the `idx_jobs_claim`
   and `idx_jobs_lease` indexes, plus the partial index `idx_jobs_printer_live` over in-flight jobs, which
   the claim's per-printer check reads. `printers.hold_job_id`, `hold_reason` and `hold_at` are added in
   the same step. Additive, nullable or defaulted, so old rows stay inert. The indexes live in
   `migrate()`, not `SCHEMA_SQL`, because `SCHEMA_SQL` runs first and an old table has no such columns yet.
   The partial indexes `idx_jobs_typical` and `idx_jobs_needs_you`, for the estimate and Needs-you queries,
   are created there too.
7. **Drop `stations`.** A separate guard, not an `else` of step 1: a database migrated by an earlier build
   already has `printer_id` yet may still carry the table. It runs after step 1 because the backfill reads
   it.

### Startup

`openDb` sets `busy_timeout = 5000` and retries `journal_mode = WAL` on `SQLITE_BUSY` (up to 50 attempts,
100 ms apart), since the API and the worker can open the file at the same moment. It sets
`synchronous = NORMAL`: under WAL that cannot corrupt the database, and a power cut can lose only the last
few commits. Seeding runs in an
immediate transaction and only once per database, recorded as `meta.seeded`; it is skipped when any
printer or profile already exists, so an operator who deleted every printer keeps zero printers across
restarts.

## queue/lease.ts

The lease core of the SQLite job queue, exported as `@conveyor/shared/queue`. The design, and the steps still
to come, are in [../design/sqlite-queue.md](../design/sqlite-queue.md).

- `inImmediate` is the only way the queue writes. It runs its step in `BEGIN IMMEDIATE` and reads the clock
  only after the write lock is held, so a step that waited on `busy_timeout` never acts on a stale `now`.
- `claimJob` takes the oldest due queued job, or first a submitted orphan to resume, and bumps
  `lease_token`. A queued job is skipped while another job for its printer is generating or slicing, and
  while its printer is held. A hold means the printer may still have a job the queue lost track of, so no
  job is prepared for it until an operator releases it with `releasePrinterHold`, which the api exposes as
  `POST /catalog/printers/:id/release`. A queued job whose `params_json` doesn't parse is settled `failed`
  at the generator stage with `UNREADABLE_PARAMS_REASON`, in the same transaction, and the claim moves on to
  the next job, so one corrupt row can't block the queue. A submitted orphan is resumed without its params,
  which resuming doesn't read.
- Every write against a held lease (`renewLease`, `releaseLease`) checks owner, token and an unexpired
  `lease_until`. A worker past its own lease cannot write, even before anyone takes the job over.
- `releaseLease` requeues an unsubmitted job without counting the attempt and leaves a submitted one as an
  orphan for the next claim. An unsubmitted job with a cancel request settles `canceled` instead, with an
  event, because the claim skips such a job and it would otherwise sit in `queued` forever. A submitted job
  stays an orphan even with a cancel request, because only the worker can stop the printer. It refuses
  (`submitting`) between the submit intent and the marker, because the outcome of that submit is still
  unknown.

## queue/reaper.ts

`reapExpired` takes over in-flight jobs whose worker has stopped renewing. It runs in `inImmediate`, so it
reads the clock only after it holds the write lock. A renewal another process committed while the reaper
waited for the lock therefore never looks like a lease set too far ahead (#124).

It matches an in-flight row when one of three things holds:

- `lease_until` has passed;
- `lease_until` lies more than one lease length ahead, which only a backward clock step produces;
- the row has no lease and no submit marker, which no correct write leaves behind.

Every takeover bumps `lease_token`, so the old owner's later writes are refused. Each row gets one outcome:

| Row | Outcome |
|---|---|
| No submit intent, cancel requested | `canceled`, with an event, so the job is not left in `queued` where no claim takes it. With an intent, a cancel request changes nothing: the rows below apply |
| No submit intent, attempts left | `queued`, after 5 s, then 10 s, of backoff |
| No submit intent, attempts used up | `failed`: the worker lost the job before it reached the printer |
| Submit intent but no marker | `failed`: check the printer. In the same transaction it holds the printer (`printers.hold_job_id`, `hold_reason`, `hold_at`) with `UNKNOWN_REASON`, unless the printer is already held |
| Submit marker | an orphan: the lease is cleared and the next claim resumes the job |

## queue/cancel.ts

Cancel keeps the api's contract: `200` for a settled job, `404` for an unknown one, `200 canceled` for a
queued one and `202 canceling` for one in flight.

- `requestCancel` decides in one immediate transaction:
  - a settled job returns its state;
  - a missing job returns `unknown`;
  - a queued job becomes `canceled` at once, with an event. The claim takes the same write lock, so a job is
    either claimed or canceled, never both;
  - an in-flight job gets `cancel_requested_at` (the first request's time is kept) and returns `canceling`.
- `isCancelRequested` is the read the worker's cancel tick polls.
- The printer slot refuses a job with a cancel request (`canceled`), so a cancel that lands before the slot
  never reaches `submit()`.
- `settleCancel(lease, stopConfirmed)` settles a canceled job that the worker owns:
  - `canceled` when nothing reached the printer (no intent), or the printer confirmed the stop;
  - otherwise `failed` with `STOP_UNCONFIRMED_REASON`, and the printer held in the same transaction, because
    the printer may still have the job.

  Both outcomes clear the lease, so the job is never submitted again. It settles nothing without a cancel
  request or a live lease, or for a job that has already settled.

## queue/resume.ts

What the worker needs to resume a job that was already on the printer when its last worker stopped.

- `readResumeState(lease)` returns what a resumed run needs, only to the job's live owner and only for a job
  with the marker: the handle `markSubmitted` stored, the artifact paths and the stage timings. A stored handle
  that does not parse as a `PrintHandle` reads as `null`. The timings come through `readSnapshot`, so they are
  validated like any status event.
- `failResume(lease)` settles a resumed job `failed` with `RESUME_FAILED_REASON` and holds its printer, in one
  immediate transaction, then records the event. It is fenced and only acts on a job with the marker. The
  printer may still be printing the job the worker lost track of, so nothing else may be sent to it until an
  operator checks it and releases the hold.

## queue/submit.ts

The two durable writes that bracket `transport.submit()`. Together they make sure no job reaches a printer
twice.

- `takePrinterSlot` moves a sliced job to `transferring` and writes the submit intent (`submit_started_at`)
  in one immediate transaction, then records a `transferring` event. The fenced `UPDATE` is the guard: it
  requires the live lease, `slicing`, no intent yet, no other job transferring or printing on the printer,
  and no hold. Only when it changes nothing does a fenced `SELECT` in the same transaction say why. Its
  outcomes:
  - `taken`;
  - `busy`: another job is transferring or printing on that printer, or the printer is held. The job stays
    `slicing` with no intent, and the caller retries;
  - `canceled`: a cancel was requested. The job stays `slicing` with no intent, and the caller settles it
    with `settleCancel` instead of submitting it;
  - `refused`: the job is not `slicing`, or already has an intent;
  - `lost`: the lease is gone.
- `markSubmitted` writes the marker (`submitted_at`) and the printer handle, once, under the lease, and only
  for a `transferring` job with an intent. The worker must write it before it reports `printing`; a marker
  refused because the job already says `printing` ends, after a crash, in a hold rather than a resume.
- Never resubmit:
  - `takePrinterSlot` refuses any job that already has an intent;
  - the reaper fails an intent-without-marker job and holds its printer;
  - a job with the marker is resumed by the claim and never re-enters the slot.

  Between those rules, no path calls `submit()` a second time.
- Both writes run under `withFullSync`. `openDb` keeps connections at `synchronous = NORMAL`, where a power
  cut can lose the last commits; the intent and marker must survive one. `withFullSync` sets `FULL`, runs the
  step and resets `NORMAL` in a `finally`, all in one synchronous block. `bun:sqlite` is synchronous, so no
  other write on the connection can run at `FULL` meanwhile, and a throwing step cannot leave it there.
- The worker calls them through `queueDeps` (see [worker.md](worker.md#queue-depsts)).

## queue/hold.ts

A printer hold says the printer may still have a job the queue lost track of. While `printers.hold_job_id`
is set, `claimJob` prepares no new job for that printer.

- `holdPrinter(db, { printerId, jobId, reason, at })` sets `hold_job_id`, `hold_reason` and `hold_at`, but
  only on a printer with no hold, so the first hold and its reason stay until someone releases it. It runs
  inside its caller's transaction, so the hold and the job's settled state commit together. Its callers:
  - `writeStatus`, when a terminal write lands inside the upload window (`UPLOAD_SETTLE_REASON`);
  - `settleCancel`, when the printer did not confirm the stop (`STOP_UNCONFIRMED_REASON`);
  - the reaper, for a job with a submit intent but no marker (`UNKNOWN_REASON`);
  - `failResume`, when a worker restarted mid-print and could not reconnect to the printer
    (`RESUME_FAILED_REASON`).
- `releasePrinterHold(db, printerId)` clears all three columns and returns `true` only when there was a
  hold. The API's `POST /catalog/printers/:id/release` calls it after an explicit confirmation (see
  [api.md](api.md#printer-holds-routesprinter-holdsts)).

## queue/status.ts and queue/event-log.ts

A job's live status is its `jobs` row plus an append-only log in `job_events`. Each event is a serialized
`JobStatusEvent`, the same frame the WebSocket sends.

- `writeStatus` is the worker's one way to change a job's status. It is fenced like every lease write
  (owner, token, unexpired lease), and it never overwrites a terminal state. That replaces the Redis Lua
  script's terminal guard. An event is appended only when the write is accepted, so a refused write
  leaves no trace. An identical repeated write is accepted and appends a second event; coalescing repeats
  is the worker's job. Writing a terminal state also settles the lease: owner and expiry cleared, token bumped.
- `writeStatus` cannot move a job into or out of the upload window, because only `takePrinterSlot` and
  `markSubmitted` may. By target state:
  - `transferring` needs a submit intent and no marker, so only the slot starts an upload, and a job on
    the printer cannot go back to uploading;
  - `printing` needs the submit marker, so a job leaves the window only through `markSubmitted`;
  - `queued`, `generating` and `slicing` need no intent, so a job with one cannot go back;
  - `canceled` is refused once the job has the marker, so a job on the printer is canceled only through
    `settleCancel`, which confirms the stop or holds the printer;
  - otherwise a terminal state is accepted. Inside the window, though, `done`, `failed` and `canceled` all
    settle the job as `failed` and hold its printer in the same transaction, because nobody knows what
    the printer received. The worker's own error is kept; without one the error is
    `UPLOAD_SETTLE_REASON`, which is also the hold's reason. The next job for that printer is not
    claimed until someone releases the hold. So a worker that catches a transport error can settle at
    once, without waiting for the reaper, and still never frees a printer in an unknown state.

  A refused write appends nothing. Without these rules one worker bug could start a second upload to a busy
  printer, or hide an unknown submit from the reaper (#134).
- `appendEvent` is shared by every write that changes a job's state outside `writeStatus`:
  - `enqueueJob` records the first `queued` event;
  - `claimJob` records `generating` for a queued job (a resumed orphan keeps its state and records nothing);
  - `releaseLease` and the reaper record `queued` on a requeue;
  - the reaper records `failed`, with its error.

  A requeue also clears `stage`, `progress` and `message`, so a snapshot read after it matches the `queued`
  event a live tail just delivered.
- `readSnapshot` returns the row as a `JobStatusEvent` together with the job's highest event `seq`, read in
  one statement. One statement sees one committed state, so a live tail that starts after that cursor
  neither misses nor repeats an event.
- `readJobFields` returns the job's printer, profile, generator and `created_at` as an unchecked candidate.
  The caller checks it with `jobFieldsSchema` (see [job-view.ts](#job-viewts)), so a legacy row with a null
  printer reads as incomplete rather than throwing. A `params_json` that does not parse throws.
- `tailEvents(jobId, afterSeq)` returns later events in `seq` order, 100 at a time. A stored event that
  does not parse as a `JobStatusEvent` throws rather than being skipped.
- `pruneEvents` deletes the events of jobs settled more than `EVENT_RETENTION_MS` (7 days) ago. The `jobs`
  row stays, because it is history. The SQLite worker loop runs it hourly (see [worker.md](worker.md#loopts)).
- Progress coalescing (at most one progress write per second per job) lives in the worker's `queueDeps`,
  which owns the flush timer.

## db/schema.sql.ts

The idempotent DDL applied on every boot; `CREATE TABLE IF NOT EXISTS` makes first run and restart
identical. Column reference: [../DATA-MODEL.md](../DATA-MODEL.md).

- The schema declares no foreign keys even though `openDb()` sets `PRAGMA foreign_keys = ON`. A job stores
  the printer and profile ids it used as historical facts about a finished run; deleting a printer today
  must not rewrite what a job printed on last week. Job history therefore keeps ids that may no longer
  resolve, surfaced as empty.
- Time columns are epoch-ms integers.
- `profiles.orca_*_json` are written and cleared together; `NULL` falls back to the immutable files under
  the bundled profile path. `profiles.prusa_ini` is `NULL` for the bundled config.
- `printers.allowed_generators_json` is a JSON array of generator ids; `NULL` allows all.
- `jobs.timings_json` is a JSON array of `{stage, enteredAt, durationMs}`; `NULL` for rows recorded before
  timings existed and for jobs that failed before entering any stage.
- `job_events` is a new table, so `CREATE TABLE IF NOT EXISTS` adds it to old databases without a migration
  step. `idx_job_events_job (job_id, seq)` serves the tail and snapshot cursor.

## db/seed.ts

The default catalog: the printers you can print to and the profiles you can print with. A job names one of
each.

- `orca/klipper-pla-0.2` is an OrcaSlicer Klipper bundle exported from the Creality K1 family, verified
  slicing a cube to Klipper g-code in the worker image on 2026-06-30.
- The `prusa/*` profiles use PrusaSlicer, which is multi-arch (apt) and verified headless.

Both are described in [../archive/M1-WORKER-ENGINES.md](../archive/M1-WORKER-ENGINES.md).
