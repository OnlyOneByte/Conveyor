# packages/worker

The worker that drives a job through generate, slice and transport, on BullMQ by default or on the SQLite queue
when `CONVEYOR_QUEUE=sqlite` ([main.ts and mode.ts](#maints-and-modets)). Code in this package carries no
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
  AppImage for this arch from GitHub's release API and extracts it. `ORCA_RELEASE` is pinned to `2.4.1`, the release the
  bundled profile was exported from, and each AppImage is checked against a pinned sha256. Orca runs headless under xvfb: the Orca slicer plugin spawns it through
  `xvfb-run -a`. The GL/GTK libraries in the apt line (`libopengl0`, `libglu1-mesa`, `libwebkit2gtk`, the
  mesa GL/EGL drivers, gstreamer) are the minimal set found by running `--slice` in this image until it
  produced gcode. `ORCA_DATADIR` points at the bundled vendor profile tree, because Orca leaf presets resolve
  `inherits` against it.
- **OpenSCAD** is built from source in the `openscad` builder stage, on `debian:trixie-slim`, for every arch.
  The distro `openscad` (2021.01) cannot parse the current gridfinity-rebuilt library, which needs a 2023+
  build. `scripts/fetch-openscad-source.sh` downloads the upstream `openscad-2026.11-RC0.src.tar.gz` and checks its
  pinned sha256, its GnuPG signature from the OpenSCAD release key and the commit in its `COMMIT.txt`; then
  `scripts/build-openscad.sh` builds it headless (`NULLGL`, STL export only) and installs it to `/opt/openscad`. It links only against
  Debian trixie's shared libraries, so no `LD_LIBRARY_PATH` is set; the final stage installs their runtime
  packages. `/opt/openscad/share/doc/openscad/SOURCE` names the commit, tarball URL and sha256.

Engine verification details: [archive/M1-WORKER-ENGINES.md](../archive/M1-WORKER-ENGINES.md).

## main.ts and mode.ts

`main.ts` is the image's entry point. It picks the queue with `queueMode` from `@conveyor/shared`, which reads
`CONVEYOR_QUEUE` (`redis`, the default, or `sqlite`), logs it, and starts `startRedisWorker` (`index.ts`, BullMQ) or `startSqliteWorker`. That work is `startWorker(env)`, which tests call in process; only the image's run of the file exits on an error and installs the signal handlers. Anything else exits with
code 1. In `sqlite` mode it also parses `WORKER_CONCURRENCY` once, as a positive integer (default 2), and exits
with code 1 on anything else, because `NaN` would remove the engine cap and `0` would run nothing. `SIGTERM` or
`SIGINT` calls `stop()` and exits 0 once it returns. In `sqlite` mode that is once every running job has been
released ([loop.ts](#loopts)); in `redis` mode `stop()` waits for BullMQ's running jobs to finish. Either way it
then waits, for at most 2 s, for any engine `SIGKILL` still in its grace (`settleGroupKills`), so an engine that
ignored `SIGTERM` is not left running after the worker exits. A `SIGKILL` is dropped once the engine has exited and
closed its output and its process group is empty (`kill(-pid, 0)` answers `ESRCH`), so a recycled group id is never signalled and an engine that stopped on `SIGTERM` adds no wait. The handler is
installed with `process.once`, so a second signal during the grace period kills the process at once. In `sqlite`
mode a job caught between intent and marker is then failed by the reaper with its printer held, as for any crash
in that window. In `redis` mode a killed job stalls, BullMQ fails it and the Redis reaper records it with
`ORPHAN_REASON`, with no hold ([redis-reaper.ts](#redis-reaperts)).
`sqlite` also exits with code 1 unless `CONVEYOR_QUEUE_UNSTABLE=1` is set, while the SQLite queue is still
experimental. The api reads the flag through the same `queueMode`, so the two cannot parse it differently.
Compose passes one `${CONVEYOR_QUEUE:-redis}` and one `${CONVEYOR_QUEUE_UNSTABLE:-}` to both the api and the
worker, so in a normal install they always run the same queue; `queue-mode.test.ts` checks both services.

In both modes `main.ts` starts `startHeartbeat` (`heartbeat.ts`). It writes `{ at, engines }` to the
`worker_heartbeat:<id>` row of the `meta` table at start and every 15 seconds. `<id>` is `CONVEYOR_WORKER_ID`, or
else the host name, so each worker has its own row; two workers outside containers on one machine need distinct
`CONVEYOR_WORKER_ID`s. Each beat looks for every engine's binary again
(`OPENSCAD_BIN`, `ORCA_BIN`, `PRUSA_BIN`, or `openscad`, `orca-slicer` and `prusa-slicer` on `PATH`), so a binary
removed while the worker runs shows as `missing` within a beat; `stub` with `CONVEYOR_ENGINE_STUB=1`. Each write
also drops the single `worker_heartbeat` row from before per-worker beats and any row over a day old. A worker that stops cleanly (`SIGTERM`, as `docker compose up` sends
before it recreates a container) removes its own row, so only a worker that died stays listed as down. A write that
fails is logged and never stops the worker. The api's `GET /health/deep` reads these rows and ages them on its own clock, so the api and the workers
must share a clock (one host, or synced clocks).

## printer-lock.ts

In Redis mode `printStage` takes a per-printer lock before the idle check and releases it in a `finally` once the
print settles, so two workers never upload to or start one printer at once (the SQLite queue's `TAKE_SLOT` already
serializes printers). The lock is `printer:<id>:lock`, set with `SET NX PX 60000` to a token per job; a timer renews
it every 20 s, and renew and release are Lua scripts that only touch the key while it still holds the job's token.
A canceled print is stopped (`stopPrinter`, `stop.ts`) before that `finally` releases the lock, so the next job
waiting for the printer doesn't find it still printing and fail as busy. `settleError` then reuses that stop's result
(`run.stop`) instead of sending a second one. A lost lease, or a print that ends any way other than a cancel, sends
no stop. The wait for the stop is bounded at 20 s (`STOP_BOUND_MS`, above the shipped transports' 15 s cancel
timeout), because `TransportPlugin.cancel` doesn't require a bound of its own. When the bound expires, the worker
aborts the signal it passed to `cancel()` before it releases the lock, so a late stop can't reach the printer
after the next job has started on it. A stop that hasn't answered by then
releases the lock and settles the job `failed`: "cancel requested but the printer did not confirm the stop: no answer
within 20000 ms; check the printer".
A job that finds the printer locked waits, polling every 2 s, until it gets the lock or is canceled. A worker that
dies stops renewing, so its lock expires within 60 s. Before each lock claim the worker checks the printer's SQLite
hold again, and refuses the job with `printer is on hold: <reason>` while one is set. That covers a hold placed
while the job was modelling or slicing; one placed before the job was claimed already kept it queued (see
[index.ts](#indexts)). On the SQLite queue, a hold placed mid-job makes the sliced job wait at `takePrinterSlot`
instead. When a transport throws
`PrintMayHaveStartedError` (Moonraker's print start gave no answer), `printStage` holds the printer in either queue
mode, with that error as the reason, until someone releases it.

## printer-files.ts

After every print `printStage` starts settles (done, failed, or canceled on the printer), and while the printer lock or the SQLite slot is
still held, `prunePrinter` calls the transport's `pruneFiles` with the names to keep. `filesToKeep` builds them
from `CONVEYOR_PRINTER_KEEP_FILES` (default 5, decimal digits only, parsed with zod in `printerKeepFiles`): this job's `printerFileName` plus the printer's most recent
earlier jobs that got past slicing (`dbListJobs` with `reachedPrinter`: a `done` row, which on Redis is recorded with no stage, or any row whose stage is `transport`; a job canceled while queued or reaped before any stage, recorded with no stage, does not count), up to that many. Jobs
that failed while generating or slicing never put a file on the printer, so they don't use up a place. At 0 it
names none, but the transport still spares whatever file the printer has loaded, and Klipper keeps a finished
print's file loaded, so on Moonraker that file goes at a later cleanup rather than at settle. The prune is
skipped for a canceled run, a submit that threw `PrintNotStartedError` (refused, or its lock lost before START)
or `PrintMayHaveStartedError`. Just before pruning it calls `ctx.confirmStart()`, the Redis lock's token check,
and leaves the files alone if the lock was lost, so a job that lost the printer never deletes the file the
job now holding it uploaded. A prune that throws or passes its 60 s timeout is logged in the worker log, naming
any files it did remove, and never fails the job. `printerKeepFiles` parses the variable when the worker starts
and stops it, naming the variable, on anything but a whole number 0 or more.

## logger.ts

The worker logs through pino: one JSON line per message, with `level` as a name, an ISO `time` and
`"service":"worker"`. `jobLog(jobId)` gives a job's pipeline its `log`, so every line about a job carries its
`jobId`: the Redis worker builds one per job, and the SQLite loop asks `sqliteBase`'s `logFor`. Lines from the
printer lock, reaper, retention and heartbeat carry a `component`. The per-stage and settled events keep
`job-log.ts`'s `jsonLine`, which writes the same `time` and `level` fields.

## sqlite.ts

`startSqliteWorker(env, concurrency)` starts `startQueueWorker` on the database `DB_PATH` names, with the
parsed concurrency, `DATA_DIR` and a unique owner (host, pid and a random id). `sqliteBase` resolves job targets and
printers from that database, as the BullMQ worker does from its own connection.

## index.ts

The BullMQ worker, used when `CONVEYOR_QUEUE` is `redis`. `startRedisWorker(env, deps)` reads `REDIS_URL`,
`DATA_DIR`, `DB_PATH` and `WORKER_CONCURRENCY` from `env`; `deps` supplies the Redis clients, the work-dir
`mkdir` and the queue name, so tests run it on real Redis with their own queue. `stop()` closes the worker and
its two connections. `redisPrinterDeps(db, env)` builds the job's printer lookups, hold and keep set the way
`sqliteBase` does, parsing `CONVEYOR_PRINTER_KEEP_FILES` before any Redis connection is opened.

- A queued job's payload is external input. `readJobPayload` (`job-payload.ts`) parses it with
  `jobRequestSchema` from `@conveyor/shared`, the same schema `POST /jobs` uses. A payload that does not
  parse publishes a `failed` status at the `generator` stage and fails the BullMQ job; the pipeline never runs.
- **A held printer at claim time** (`hold-wait.ts`): once the payload parses, and before the control connection,
  the work dir or any modelling, `waitOutHold` reads the printer's SQLite hold. This catches a hold placed after
  `POST /jobs` passed its `409` check, so the job waits queued until Release hold, as on the SQLite queue.
  - **While held:** the job goes back to BullMQ as `delayed` for `HOLD_RECHECK_MS` (5 s), then is claimed and
    checked again. No attempt is used and nothing is recorded in history.
  - **Shown waiting:** the first check publishes `queued` with "waiting: the printer is on hold (<reason>)", so
    the job is on `/jobs/active` and `GET /jobs/:id`, with a Cancel button and no start estimate. Later checks
    publish nothing while that status stands.
  - **Cancel:** a cancel between checks removes the delayed job. One that lands during a check sets the cancel
    key, and the check settles the job `canceled` straight away instead of waiting again.
  - **After Release hold:** the first check that finds the printer free promotes that printer's older delayed
    jobs, oldest first, and goes back behind them, so the oldest jobs are released first. With several worker
    slots they then start side by side, and the printer lock decides which prints first. A job another slot has
    already promoted is skipped; any other failure to promote fails the claimed job, like other errors before
    the pipeline.
- Every step before the pipeline settles the same way when it throws: parsing the payload, creating the work
  dir and subscribing to the job's control channel. The job is recorded `failed` in SQLite at the `generator`
  stage, with the error as its reason, so it shows in history and Needs you; then `failed` is published. A
  payload that does not parse is recorded with whatever generator, printer and profile ids it does carry,
  and `unknown` for the rest. The per-job control connection is closed whatever happens.
- `recordTerminal` writes the settled job to SQLite. Notes go to `notes` in every state. Only a failed job
  has an `error`, and its reason is the stage's own failure reason with no notes mixed in.
- It starts the reaper below: one sweep at start, then every `REAPER_INTERVAL_MS` (one minute).

## redis-reaper.ts

On Redis a job only gets its SQLite row when it settles, so a job whose worker dies without recording an end
state would otherwise appear nowhere: not in history and not in Needs-you (#383). Each sweep does two things.

- **Jobs that died.** For each id in `ACTIVE_JOBS_KEY` with no SQLite row, the reaper asks BullMQ. A job still
  `waiting`, `active`, `delayed`, `prioritized` or `waiting-children` is left alone, and so is one whose snapshot
  is already terminal. Anything else is a job BullMQ gave up on (a stalled job is `failed`; see `WORKER_OPTIONS` below)
  or no longer has. It is recorded `failed` at its last stage with `ORPHAN_REASON`:
  "the worker stopped before recording how this job ended; check the printer before you retry". Its request
  comes from the BullMQ job when there is one; without one the generator is `unknown` and the printer and
  profile are empty. The same failure is published as a status, so the snapshot, the active set and any open
  WebSocket settle too.
- **A retry that died.** When the job just recorded was a retry, its original's `retried_by` claim is released,
  so the original failure, with its real error, returns to Needs-you. The dead retry is dismissed, so Needs-you
  shows the job once. Its history row stays.
- **Claims whose retry was never queued.** `dbListUnrecordedRetryClaims` lists claims whose retry has no row.
  A claim whose retry BullMQ also lacks is released on the second sweep in a row that finds it missing, so a
  claim made just before its `add` isn't cut short.

The production `Worker` is created with `WORKER_OPTIONS` (`maxStalledCount: 0`). BullMQ's default of 1
would move a job whose worker died back to `waiting` and run it again from the start, which re-sends a print
that may already be on the bed. With 0, BullMQ marks the job `failed` on the first stall, and the reaper
records it with `ORPHAN_REASON`, so a person checks the printer before retrying.

Several workers may each run the reaper. Recording is an upsert, a second terminal publish is refused, and
releasing a claim is conditional on its holder, so overlapping sweeps agree.

## pipeline.ts

- `runJob` and `resumeJob` log the job's lifecycle as one JSON line per event through
  `PipelineDeps.event`, which defaults to `jsonLine` (`job-log.ts`, stdout). They log a `stage` line each time
  the job enters a stage, and one `settled` line when it ends. That line carries the outcome (`done`,
  `canceled`, `failed` or `lease lost`), the stage it ended in, the total duration, each stage's duration and,
  for `failed`, the reason.
- Every status a transport yields while a print is watched calls `printerSeen(printerId)` before it is handled,
  so a printer that is printing keeps a fresh `lastSeenAt` without a probe. `index.ts` and `sqlite.ts` wire it
  to `markPrinterSeen` (`printer-target.ts`). `transferring` does not count: Moonraker and Elegoo yield it
  before they contact the printer. A stream that fails before the printer's first status marks nothing.
- A failed last-seen write never fails the print. It is logged, and noted once on the job
  (`SEEN_WRITE_FAILED`).
- After slicing, and again when a job resumes from its stored G-code, the worker calls
  `PipelineDeps.readFilament(gcodePath)` (`readFilamentUse` in both modes) and keeps the result for the job's
  history row. A read that fails is noted on the job (`FILAMENT_NOT_READ`) and never fails it; G-code without
  the estimate records nothing. Filament reported by the printer itself is not read.

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
- A failed job, in either queue mode, removes everything in its work directory but `engine.log`, so the job
  page keeps its **Engine log** download; a failure before any engine ran removes the whole directory. A
  canceled job removes it all. The retention reaper removes what a failed job kept, like any finished job's
  folder. A job the queue reaper cancels without a worker (`queue/reaper.ts`) keeps whatever its folder holds
  until retention.

## loop.ts

`startQueueWorker` runs jobs from the SQLite queue; `sqlite.ts` starts it.

- **Claim.** Every `claimIdleMs` (1 s), and at once when a job leaves engine work or ends, it claims while
  fewer than `concurrency` (`WORKER_CONCURRENCY`) of its jobs run an engine. A job counts from its claim
  until it reaches the printer slot; a job waiting at the slot, on the printer or resumed does not count.
  A claimed orphan runs `resumeJob`, any other job `runJob`, in `<dataDir>/<jobId>`. Before `runJob` the
  folder is emptied, so a requeued job never reuses the run before's model, g-code or `engine.log`: a slicer
  that exits 0 without writing fails the job instead of passing on the old file. A resumed job keeps its
  folder. A job id that isn't a UUID (`job-folder.ts`) names no folder: the job fails at that first claim
  with `refusedJobId`, before anything touches the disk. Every id the api has minted is a `randomUUID()`.
- **Run timer.** Each job has one timer, every `tickMs` (1 s). Each tick reads `isCancelRequested` and aborts
  the run when it is set, so a cancel reaches a running engine within a second. It also reads the lease
  (`leaseHeld`) and treats one another worker has taken, or that has run out, as lost, so a worker that
  wakes from a stall stops its engine on its next tick rather than at its next renewal. Every
  `renewEvery`-th tick (10th) renews the lease.
- **Renewal.** `renewLease` changing nothing is a lost lease. `SQLITE_BUSY` is retried every `busyRetryMs`
  (1 s) until `busyMarginMs` (5 s) before the lease ends, then the lease counts as lost. A lost lease aborts
  the run with `LeaseLostError`.
- **Reaper.** `reapExpired` runs at start and every `reapMs` (10 s).
- **Event pruning.** `pruneEvents` runs at start and every `pruneMs` (1 hour). It deletes the `job_events` of
  jobs settled more than `retentionMs` (`EVENT_RETENTION_MS`, 7 days) ago; the `jobs` row stays as history.
  The sweep lives in the worker because only the worker runs a loop in SQLite mode; a failure is logged and
  retried on the next tick.
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
| Lost lease | a fenced write that changes nothing aborts the run with `LeaseLostError`, and so does `checkLease` (`leaseHeld` in `@conveyor/shared/queue`), which runs when each engine exits (`ctx.checkLease`, called by `runEngine`) and before any settle deletes files. A run that stalled past its lease therefore never reads, copies or deletes the new owner's files after an engine step. The run leaves its work directory to the job's new owner, or to retention, and writes nothing more; it does not stop the printer, because whoever holds the job next decides |

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

## Registry

`buildRegistry` from `@conveyor/plugin-registry` (`plugins/registry/builtin`) registers every bundled plugin.
The worker is the only process that runs the adapters; the api builds the same registry but only reads it
([ADR 0001](../adr/0001-plugin-isolation.md): in-process adapters, isolated engines).

## status.ts

`StatusBus` takes the Redis client it writes with. `StatusBus.publish` sends a job status event to the Redis bus and writes the durable snapshot, so a
reconnecting PWA can `GET /jobs/:id`. State is the contract: every transition is exactly one of these
messages, forwarded verbatim to the WebSocket.
