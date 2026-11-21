# packages/worker

The BullMQ worker that drives a job through generate, slice and transport. Code in this package carries no
comments; the reasons behind it live here, one section per file.

## Dockerfile

The worker image carries the engines: OpenSCAD (generator) plus PrusaSlicer and OrcaSlicer. It is built on
the bun image, and bun runs the TypeScript worker directly with no `tsc` step.

- **Dependency stage.** Only the manifests are copied first so `bun install` stays layer-cached.
  `bun install --frozen-lockfile` validates the whole workspace graph against `bun.lock`, so every member the
  lockfile lists must be present, including `api` and `web` that the worker never imports. Leave one out and
  bun reports "lockfile had changes" and aborts.
- **PrusaSlicer** comes from apt (Debian trixie). It is multi-arch and truly headless (no xvfb), and its apt
  package pulls its own runtime libraries. It is installed on every arch.
- **OrcaSlicer** ships x86_64 and aarch64 Linux AppImages from v2.4.1. `scripts/install-orca.sh` resolves the
  AppImage for this arch from GitHub's release API and extracts it. `ORCA_RELEASE` defaults to `latest`; pass
  `x.y.z` to pin a build. Orca runs headless under xvfb: the Orca slicer plugin spawns it through
  `xvfb-run -a`. The GL/GTK libraries in the apt line (`libopengl0`, `libglu1-mesa`, `libwebkit2gtk`, the
  mesa GL/EGL drivers, gstreamer) are the minimal set found by running `--slice` in this image until it
  produced gcode. `ORCA_DATADIR` points at the bundled vendor profile tree, because Orca leaf presets resolve
  `inherits` against it.
- **OpenSCAD** is the nightly AppImage, extracted so FUSE is not needed at runtime. The distro `openscad`
  (2021.01) cannot parse the current gridfinity-rebuilt library, which needs a 2023+ nightly.
  `scripts/install-openscad.sh` resolves the latest snapshot for this arch from files.openscad.org; set
  `OPENSCAD_RELEASE=YYYY.MM.DD` or `OPENSCAD_APPIMAGE_URL=<url>` to pin one. The script writes a wrapper that
  scopes the AppImage's bundled libraries to the openscad process. A global `LD_LIBRARY_PATH` would shadow
  system libraries and break prusa-slicer, so the image never sets one.

Engine verification details: [M1-WORKER-ENGINES.md](../M1-WORKER-ENGINES.md).

## main.ts and mode.ts

`main.ts` is the image's entry point. It picks the queue with `queueMode` from `@conveyor/shared`, which reads
`CONVEYOR_QUEUE` (`redis`, the default, or `sqlite`), logs it, and loads `index.ts` (BullMQ) or starts `startSqliteWorker`. Anything else exits with
code 1. In `sqlite` mode it also parses `WORKER_CONCURRENCY` once, as a positive integer (default 2), and exits
with code 1 on anything else, because `NaN` would remove the engine cap and `0` would run nothing. `SIGTERM` or
`SIGINT` calls `stop()` and exits 0 once every running job has been released. The handler is installed with
`process.once`, so a second signal during the grace period kills the process at once; a job caught between
intent and marker is then failed by the reaper with its printer held, as for any crash in that window.
`sqlite` also exits with code 1 unless `CONVEYOR_QUEUE_UNSTABLE=1` is set, while the SQLite queue is still
experimental. The api reads the flag through the same `queueMode`, so the two cannot parse it differently.

## sqlite.ts

`startSqliteWorker(env, concurrency)` starts `startQueueWorker` on the database `DB_PATH` names, with the
parsed concurrency, `DATA_DIR` and a unique owner (host, pid and a random id). `sqliteBase` resolves job targets and
printers from that database, as the BullMQ worker does from its own connection.

## index.ts

The BullMQ worker, used when `CONVEYOR_QUEUE` is `redis`.

- A queued job's payload is external input. `readJobPayload` (`job-payload.ts`) parses it with
  `jobRequestSchema` from `@conveyor/shared`, the same schema `POST /jobs` uses. A payload that does not
  parse publishes a `failed` status at the `generator` stage and fails the BullMQ job; the pipeline never runs.
- `recordTerminal` writes the settled job to SQLite. Notes go to `notes` in every state. Only a failed job
  has an `error`, and its reason is the stage's own failure reason with no notes mixed in.

## pipeline.ts

- Settlement runs outside the stage `try`, so an error while settling a finished or printer-canceled job
  (such as the history write) propagates as is. It is not re-settled as `failed`, and the finished job's work
  directory is kept.

## settle.ts

- History is written before the terminal status is published, so a job the bus calls `done`, `canceled` or
  `failed` has already been offered to SQLite.
- The history write gets 3 attempts, waiting `historyRetryMs` (default 250 ms) and then twice that between
  them.
- A settled job publishes its notes as the status `message`, in every state; a failed job's `error.reason`
  carries only the stage's reason.
- When every attempt fails, `history not recorded after 3 attempts: <error>` is added to the job's notes, so
  it appears in the published status, and the job then rejects so BullMQ marks it failed. A failed job
  rejects with an `AggregateError` carrying both its stage error and the history error.
- A materialized profile that cannot be removed after slicing does not fail the job; it is added to the
  job's notes, which appear in the terminal status message.

## loop.ts

`startQueueWorker` runs jobs from the SQLite queue; `sqlite.ts` starts it.

- **Claim.** Every `claimIdleMs` (1 s), and at once when a job leaves engine work or ends, it claims while
  fewer than `concurrency` (`WORKER_CONCURRENCY`) of its jobs run an engine. A job counts from its claim
  until it reaches the printer slot; a job waiting at the slot, on the printer or resumed does not count.
  A claimed orphan runs `resumeJob`, any other job `runJob`, in `<dataDir>/<jobId>`.
- **Run timer.** Each job has one timer, every `tickMs` (1 s). Each tick reads `isCancelRequested` and aborts
  the run when it is set, so a cancel reaches a running engine within a second. Every `renewEvery`-th tick
  (10th) renews the lease.
- **Renewal.** `renewLease` changing nothing is a lost lease. `SQLITE_BUSY` is retried every `busyRetryMs`
  (1 s) until `busyMarginMs` (5 s) before the lease ends, then the lease counts as lost. A lost lease aborts
  the run with `LeaseLostError`.
- **Reaper.** `reapExpired` runs at start and every `reapMs` (10 s).
- **Known limits.** An orphan is only claimed while an engine slot is free, because `claimJob` cannot ask for
  orphans alone. An idle worker takes the write lock for each claim attempt, without the design's read-only
  `SELECT EXISTS` first.
- **Stop.** `stop()` stops claiming, then releases each running job by where it is:
  - before the intent (generating, slicing, waiting at the slot): the run is aborted and `releaseLease`
    requeues it with `run_after = now`, the attempt not counted;
  - between intent and marker: the submit is left to finish, the marker is written, then the job is
    released as below;
  - after the marker: the run is aborted without touching the printer, and `releaseLease` leaves it an orphan
    for the next worker to resume.

  The abort is a `LeaseLostError`, so the run writes nothing itself; the release is the one write. Compose
  gives the worker `stop_grace_period: 60s`, enough for a g-code upload on the local network. An upload that
  outlasts it is killed between intent and marker, and the reaper then fails the job and holds the printer.

## queue-deps.ts

`queueDeps` turns a claimed SQLite lease into the pipeline's status, history and cancel deps, plus the
`queue` hooks the print and settle steps call. `startQueueWorker` builds one per job. The Redis path does
not pass `queue`, so it is unchanged.

| Step | On the SQLite queue |
| --- | --- |
| Status | `writeStatus`. A repeat of the same state and stage (progress) is written at most once per `progressFlushMs` (1 s), keeping only the latest; a new state or stage is written at once and drops the pending progress |
| Printer slot | `takePrinterSlot` before `transferring`. While the printer is busy or held, the job writes `slicing` with progress 1 and `sliced; waiting for the printer` once, and retries every `slotRetryMs` (1 s). A cancel during the wait ends it |
| Marker | `markSubmitted` with the handle right after `submit()`, so the marker is written before the first `printing` status. Pending progress is dropped first: a `transferring` update flushed after the marker would be refused, and a refused write reads as a lost lease |
| Cancel | `cancelRequested` reads `isCancelRequested`. A canceled job, or one the printer reports canceled, settles through `settleCancel`: confirmed when nothing reached the printer or it stopped, otherwise `failed` with the printer held |
| History | the history step writes `model_path`, `gcode_path`, `notes`, the final `stage` and `timings` and the final message, and clears `progress`, all under the lease. A done or failed job's terminal status write then sets the same stage, timings and message; a canceled job settles through `settleCancel`, which writes only the state, so its history comes from this step |
| Resume | `resumeJob` runs a claimed orphan: it reads the stored handle, artifact paths and stage timings (`readResumeState`) into the run, publishes `printing` with `resumed after worker restart` and the timings, and watches the print. So a resumed job that ends `done` keeps its download links and every stage's duration. It never generates, slices or submits. When it cannot reconnect (no readable handle, an unknown transport or printer, a first status read that fails or a stream that ends before any status) it settles through `failResume`: `failed` with the printer held. A cancel during that first read stops the printer as usual. A failure after the first status is an ordinary print failure |
| Lost lease | a fenced write that changes nothing aborts the run with `LeaseLostError`. The run removes its work directory and writes nothing more; it does not stop the printer, because whoever holds the job next decides |

A `submit()` that fails, `PrintNotStartedError` included, settles `failed` inside the upload window, which
holds the printer. Clearing the intent for `PrintNotStartedError` without a hold is not done yet.

## profile.ts

`resolveProfileForSlice` returns the profile directory a slicer adapter should read.

- A bundled (unedited) profile keeps its immutable `/profiles` path, and its `cleanup` is a no-op. `cleanup`
  is idempotent for both sources.
- An edited profile is re-validated at the worker trust boundary, then written under the per-job work
  directory with fixed file names only. Neither the profile id nor any request input becomes part of a
  filesystem path.
- The slicer's editable format picks the shape: Orca writes three JSON documents, Prusa writes one
  `config.ini`. A slicer with no editable format always uses its bundled path.
- Before writing, the fixed `profile` child is removed, since a crashed earlier attempt may have left it
  behind. `rm` removes a symlink rather than following it. The directory is then recreated with mode `0700`.
- The Prusa directory holds only `config.ini`, so the slicer's config loader sees exactly one config and no
  bundled `.ini` leaks in beside the edit.
- When validating or writing fails, the partial directory is removed. If that removal also fails, the
  `StageError` reason ends with `; partial profile not removed: <error>`.

## registry.ts

The worker is the only process that loads real adapters. `buildRegistry` registers every bundled plugin at
startup ([ADR 0001](../adr/0001-plugin-isolation.md): in-process adapters, isolated engines).

## status.ts

`StatusBus.publish` sends a job status event to the Redis bus and writes the durable snapshot, so a
reconnecting PWA can `GET /jobs/:id`. State is the contract: every transition is exactly one of these
messages, forwarded verbatim to the WebSocket.
