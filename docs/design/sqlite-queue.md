# Design: a job queue in SQLite

Status: proposed, awaiting review. No code lands until this page is accepted.

Fixes [#5](https://github.com/OnlyOneByte/Conveyor/issues/5). Follows the queue sketch in the stack proposal
("Queue design (Option A)").

## Summary

Conveyor runs every job through BullMQ on Redis, and uses Redis for four more things: a status pub/sub bus,
a cancel flag and channel, a per-job snapshot, and an active-jobs set. All five move into the SQLite
database the api and worker already share (`/data/conveyor.db`, WAL mode). Redis and BullMQ are deleted.

Three outcomes:

1. **A worker restart never sends g-code twice (#5).** The queue records the moment a print was submitted,
   together with the printer handle. A reclaimed job that was already submitted resumes watching the print;
   it never runs `submit()` again.
2. **Self-hosting loses the `redis` container and, in the last PR, the separate `worker` container.**
   Compose goes from five services (caddy, web, api, worker, redis) to three (caddy, web, conveyor). It
   reaches one plus Caddy once the UI rewrite serves the SPA from the app process, which is outside this
   design.
3. **One source of truth.** A job's queue state, live status and history are one row, so the snapshot, the
   active set and the history list cannot disagree. Today they can, which is why `/jobs/active` prunes stale
   members.

## What Redis does today

| Use | Where | Replaced by |
|---|---|---|
| BullMQ queue `conveyor-jobs` | `api/src/queue.ts`, `worker/src/index.ts` | `jobs` rows plus a claim query |
| Status pub/sub `job:<id>:status` | `worker/src/status.ts`, `GET /jobs/:id/ws` | `job_events` rows, polled |
| Snapshot `job:<id>` with a terminal guard (Lua) | `shared/src/status.ts`, `GET /jobs/:id` | the `jobs` row, with a guarded `UPDATE` |
| Active set `jobs:active` | `GET /jobs/active` | `SELECT ... WHERE state NOT IN (terminal)` |
| Cancel flag `job:<id>:cancel` (7-day TTL) and channel `job:<id>:control` | `routes/jobs.ts`, `worker/src/index.ts` | the `cancel_requested_at` column |

## Goals and non-goals

Goals:

- Exactly one `submit()` per job, across crashes, restarts and upgrades.
- Cancel behaves as it does today, including the HTTP codes the web client relies on.
- The web client keeps working unchanged: same routes, same `JobStatusEvent` frames on the WebSocket.
- At most one running job per printer.
- The queue is testable with an injected clock and no network.

Non-goals:

- Multiple hosts. SQLite over NFS is unsafe; the queue supports several processes on one host sharing a local
  volume, and nothing more.
- Retrying a job whose pipeline failed. A `StageError` is terminal today and stays terminal. Retries cover
  only a lost worker.
- Priorities, scheduled jobs and job dependencies. Nothing uses them.
- Moving the live channel from WebSocket to SSE. That belongs to the UI rewrite; the event log here supports
  both.
- Drizzle. The queue uses the same hand-written `bun:sqlite` style as `shared/src/db`.

## Schema

The queue extends the existing `jobs` table rather than adding a parallel one. Today a row is written only
when a job settles; from now on it is inserted at enqueue and updated through the job's life. A migration
step, guarded on the live table shape like the existing ones in `db/migrate.ts`, adds these columns:

```sql
ALTER TABLE jobs ADD COLUMN progress            REAL;
ALTER TABLE jobs ADD COLUMN message             TEXT;
ALTER TABLE jobs ADD COLUMN attempts            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN max_attempts        INTEGER NOT NULL DEFAULT 3;
ALTER TABLE jobs ADD COLUMN run_after           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN lease_owner         TEXT;
ALTER TABLE jobs ADD COLUMN lease_token         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN lease_until         INTEGER;
ALTER TABLE jobs ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE jobs ADD COLUMN submitted_at        INTEGER;
ALTER TABLE jobs ADD COLUMN print_handle_json   TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_claim  ON jobs (state, run_after, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease  ON jobs (state, lease_until);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs (printer_id) WHERE state IN ('generating', 'slicing', 'transferring', 'printing');

CREATE TABLE IF NOT EXISTS job_events (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT    NOT NULL,
  event  TEXT    NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, seq);
```

- `state` keeps the existing `JobState` union: `queued`, `generating`, `slicing`, `transferring`, `printing`,
  `done`, `failed`, `canceled`. A job is *running* when its state is one of the four in-flight states. No new
  state is added.
- `event` is a serialized `JobStatusEvent`: exactly the frame the WebSocket sends today, so the api forwards it
  without reshaping it.
- Rows written before the migration are terminal history rows. The defaults leave them inert: `attempts` 0,
  no lease, no cancel.

### Why the lease lives on the job row

A separate `job_leases(job_id, owner, token, until)` table was considered. One job has at most one lease, so
a separate table adds a join to every claim and renewal, and adds a second row that can disagree with the
first. Keeping the lease on the row also makes the claim a single `UPDATE`. The cost is that `jobs` carries
queue columns that are `NULL` once the job settles. That is acceptable, and settling clears them.

### Fencing with `lease_token`

Every claim increments `lease_token`. Every write a worker makes for a job (renew, status, submit marker,
settle) carries `AND lease_token = ?`. A worker whose lease expired and was taken over by another worker gets
`changes() = 0` on its next write. It then aborts its run without touching the printer again. This turns
"two workers believe they own the job" from a race into a checked error.

## Claiming

### Enqueue

`POST /jobs` keeps its validation and inserts the row in one statement:

```sql
INSERT INTO jobs (id, generator_id, params_json, printer_id, profile_id, state, run_after, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'queued', ?now, ?now, ?now);
```

It inserts the first `queued` event in the same transaction, then returns `202 { jobId }` as today.

### Atomic claim

A worker claims in one immediate transaction, so two workers can never take the same row:

```sql
BEGIN IMMEDIATE;
UPDATE jobs
   SET state       = CASE WHEN submitted_at IS NULL THEN 'generating' ELSE state END,
       attempts    = CASE WHEN submitted_at IS NULL THEN attempts + 1 ELSE attempts END,
       lease_owner = ?worker, lease_token = lease_token + 1,
       lease_until = ?now + ?leaseMs, updated_at = ?now
 WHERE id = (
   SELECT j.id FROM jobs j
    WHERE (    (j.state = 'queued' AND j.run_after <= ?now AND j.cancel_requested_at IS NULL)
            OR (j.submitted_at IS NOT NULL AND j.lease_owner IS NULL
                AND j.state IN ('transferring', 'printing')))
      AND NOT EXISTS (
        SELECT 1 FROM jobs r
         WHERE r.printer_id = j.printer_id
           AND r.id <> j.id
           AND r.state IN ('generating', 'slicing', 'transferring', 'printing'))
    ORDER BY j.submitted_at IS NULL, j.created_at, j.rowid
    LIMIT 1)
RETURNING *;
COMMIT;
```

- `BEGIN IMMEDIATE` takes the write lock up front, so the subquery and the update see the same snapshot.
  SQLite allows one writer at a time, and `busy_timeout = 5000` (already set in `openDb`) queues a
  competing claimant instead of failing it.
- The claim picks two kinds of row. A `queued` job starts at `generating` and counts an attempt. An orphaned
  job that was already submitted keeps its state and is resumed (see
  [Crash recovery](#worker-crash-recovery)). Orphans sort first, because a printer is busy with them.
- `r.id <> j.id` keeps an orphan from blocking itself. Its printer's queued jobs still wait, because the
  orphan counts as running.
- A worker polls with this claim every `claimIdleMs` (default 500 ms) while it has free capacity
  (`WORKER_CONCURRENCY`, default 2 as today). After it settles a job, it claims again at once.

### Visibility timeout and renewal

- `leaseMs` defaults to 30 s, and the worker renews every 10 s:
  `UPDATE jobs SET lease_until = ?now + ?leaseMs WHERE id = ? AND lease_token = ? AND state IN (in-flight)`.
- Renewal runs on a timer independent of the stage. Engines run through `Bun.spawn` and printers through
  async I/O, so the event loop stays free to renew during a long slice or print.
- A renewal that changes 0 rows means the lease was lost, either taken over or settled by a cancel. The
  worker aborts its `AbortController` with a `LeaseLostError`, which is handled as "stop and do not settle".
  The owner of the new lease settles the job.

### Retries and backoff

Only a lost worker causes a retry. A reaper runs on every worker's claim tick, and once at startup:

```sql
UPDATE jobs
   SET state = CASE WHEN submitted_at IS NULL AND attempts < max_attempts THEN 'queued'
                    WHEN submitted_at IS NOT NULL THEN state
                    ELSE 'failed' END,
       run_after = ?now + ?backoffBaseMs * (1 << (attempts - 1)),
       lease_owner = NULL, lease_until = NULL, updated_at = ?now
 WHERE state IN ('generating', 'slicing', 'transferring', 'printing')
   AND lease_until < ?now
RETURNING id, state, attempts, submitted_at;
```

- **Not yet submitted:** the job goes back to `queued` with exponential backoff (`backoffBaseMs` 5 s, so 5 s,
  then 10 s). Regenerating and re-slicing are safe because nothing has reached the printer.
- **Attempts exhausted:** the job is `failed` with the reason
  `worker lost the job <n> times before it reached the printer`.
- **Submitted:** the row keeps its in-flight state with no lease, so the next claim resumes monitoring
  instead of queueing it again. The reaper never resets `submitted_at`.
- Each transition the reaper makes appends a `job_events` row and, for `failed`, settles history exactly as
  `settle.ts` does.

The real reaper is written as two statements, the requeue and the fail, in one transaction rather than one
`CASE`. That keeps each easy to test; the `CASE` above only shows the rules side by side.

## Behaviour

### Cancel

`POST /jobs/:id/cancel` keeps today's contract, from `api/src/cancel.ts`. One transaction decides by the
row's state:

| State when cancel arrives | Today | With the SQLite queue |
|---|---|---|
| Terminal | `200` with that state | Same; nothing is written |
| No row | `404 unknown job` | Same |
| `queued` (BullMQ `waiting`, `delayed`) | Job removed, `canceled` published and recorded, `200 canceled` | `UPDATE ... SET state = 'canceled', cancel_requested_at = ?now WHERE state = 'queued'` plus a `canceled` event in the same transaction, `200 canceled` |
| In flight | Cancel flag and control message, `202 canceling` | `SET cancel_requested_at = ?now`, `202 canceling` |
| Snapshot exists but BullMQ lost the job | Flag set, `202 canceling` | Cannot happen: the row is the job |

The worker side is unchanged in shape. `PipelineDeps.cancelRequested()` becomes
`SELECT cancel_requested_at IS NOT NULL FROM jobs WHERE id = ?`, read at each `checkpoint` and by the
print-stage poll (every `cancelPollMs`, 2 s). The control channel's instant abort becomes the next poll, so
cancel is acknowledged within 2 s rather than at once. `settle.ts` keeps stopping the printer, writing
`canceled` (or `failed` when the printer refuses to stop) and recording notes.

The queued-cancel `UPDATE` and the claim both take the write lock, so a job is either claimed or canceled,
never both. The claim's `cancel_requested_at IS NULL` filter covers a cancel that lands between a requeue
and the next claim.

The 7-day cancel-flag TTL goes away. The flag lives on the row, which is kept as history.

### Worker crash recovery

This is the fix for #5.

1. `printStage` calls `transport.submit()`. On success, before anything else, the worker writes
   `submitted_at = ?now, print_handle_json = ?handle` under its `lease_token`. That write is the durable
   "the printer has this job" marker.
2. The worker dies (OOM, `docker compose up -d`, a reboot). Renewals stop, and `lease_until` passes.
3. The reaper clears the lease but keeps the state and `submitted_at` (see the table above).
4. The next claim sees `submitted_at IS NOT NULL` and enters `watchPrint` directly with the stored handle,
   skipping generate, slice and submit. It publishes a `printing` event whose `message` reads
   `resumed after worker restart`.
5. If the transport cannot resume (no `status()` for a stored handle, or the first status read fails), the
   job settles `failed` with
   `worker restarted mid-print and could not reconnect; check the printer before starting another print`.
   It is never resubmitted.

A crash between `submit()` returning and the marker commit is the one remaining window, a single local
SQLite write wide. The design accepts it and documents it in `docs/modules/worker.md`. Closing it needs
printer-side idempotency, which neither transport offers.

**Graceful shutdown.** The worker handles `SIGTERM`. It stops claiming. For each job not yet submitted, it
aborts the run and requeues it at once (`run_after = now`, the attempt not counted). For each job already
submitted, it sets `lease_until = now` so the next worker resumes monitoring without waiting 30 s. The print
itself is never touched. Compose gets `stop_grace_period: 30s`.

### Ordering

- FIFO by `created_at`, with `rowid` as the tie-break for jobs enqueued in the same millisecond.
- One running job per printer. BullMQ did not enforce this: two jobs for one printer could run at once and
  collide at `submit()`. A queued job for a busy printer waits without blocking jobs for other printers.
- `WORKER_CONCURRENCY` still caps the jobs one worker runs at once.

## Live status

### Writes

Every status change the worker publishes today through `StatusBus.publish` becomes one transaction:

```sql
UPDATE jobs SET state = ?, stage = ?, progress = ?, message = ?, timings_json = ?, updated_at = ?now
 WHERE id = ? AND lease_token = ? AND state NOT IN ('done', 'failed', 'canceled');
INSERT INTO job_events (job_id, event, at) SELECT ?, ?, ?now WHERE changes() = 1;
```

- The `state NOT IN (terminal)` guard replaces the Lua script's "never overwrite a terminal snapshot". A
  late `printing` event after `canceled` changes nothing and appends nothing.
- Progress is coalesced. `ctx.report()` can fire many times a second, so it updates the row on every call
  but appends a `job_events` row at most once per `progressEventMs` (default 1 s) per job, plus every state
  or stage change, which are never dropped. Without this, the event table would grow by thousands of rows
  per slice.

### Reads

| Route | Today | With the SQLite queue |
|---|---|---|
| `GET /jobs/:id` | Redis snapshot | The row, mapped to `JobStatusEvent` |
| `GET /jobs/active` | Set plus snapshots, pruned | `SELECT ... WHERE state NOT IN (terminal) ORDER BY updated_at DESC` |
| `GET /jobs/:id/ws` | Redis subscription | Event-log tail, below |
| `GET /jobs-history` | Terminal rows | Unchanged, filtered to terminal states so queued jobs do not appear early |

### The event-log tail

The WebSocket handler sends the current snapshot first, then tails `job_events`:

```sql
SELECT seq, event FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT 100;
```

- **Two processes** (PRs 2 to 4): the api polls every `tailPollMs` (default 250 ms) for each open socket. In
  WAL mode readers never block the writer and the writer never blocks readers, and the query is an index
  range scan on `(job_id, seq)`. One poll per open socket per 250 ms is negligible at self-hosted scale.
- **One process** (PR 5): the queue module exposes an in-process `EventTarget`. Every committed event
  dispatches `job:<id>` after `COMMIT`, and the tail wakes on it instead of waiting for the next poll. The
  poll stays as a fallback for events written by a separate `conveyor work` process.
- The socket closes after it forwards a terminal event, as today.
- An SSE endpoint can later reuse the same tail with `Last-Event-ID = seq`. That is out of scope here.

**Retention:** a sweep deletes `job_events` rows for jobs that have been terminal for more than 7 days. The
`jobs` row stays, because it is history.

## Process model

| Phase | Processes | Compose services |
|---|---|---|
| Today | api, worker, redis | caddy, web, api, worker, redis |
| PRs 2 to 4 | api and worker share `/data/conveyor.db` | caddy, web, api, worker |
| PR 5 | `conveyor serve` runs the api and an in-process worker; `conveyor work` runs a worker alone | caddy, web, conveyor |
| UI rewrite (separate) | the app serves the SPA too | conveyor, plus optional caddy |

SQLite must be on a local volume, and `docs/self-hosting.md` says so. The api and worker share one database
file, so they must run on the same host.

## Rollout

### Migrating from Redis

Default: **drain, then upgrade.** `docs/self-hosting.md` tells the operator to wait until `/jobs/active` is
empty, which it already advises for printing jobs. For operators who cannot drain, PR 4 ships a one-shot
importer, `bun run --cwd packages/worker migrate-redis`. It runs only when `REDIS_URL` is set and reads the
old keys:

| Redis state | Imported as |
|---|---|
| BullMQ `waiting`, `delayed`, `prioritized` | `queued` rows, in their BullMQ order, with their original ids |
| BullMQ `active`, snapshot not yet `transferring` | `queued` (safe to rerun: nothing reached the printer) |
| BullMQ `active`, snapshot `transferring` or `printing` | `failed` with reason `interrupted by the queue upgrade; check the printer`. There is no stored handle to resume from, and resubmitting is what #5 forbids |
| Snapshot terminal | Skipped: it is already in SQLite history |
| Cancel flags | Applied as `cancel_requested_at` on the imported row |

The importer is idempotent (`INSERT ... ON CONFLICT(id) DO NOTHING`), prints one line per job, and exits
non-zero when Redis is unreachable. It is deleted one release after PR 4.

### Feature flag

PRs 2 and 3 switch the worker and the api separately, so for those two PRs both stacks exist behind
`CONVEYOR_QUEUE=redis|sqlite` (default `redis`). PR 4 flips the default, deletes the Redis path and removes
the flag. The flag exists only to keep each PR shippable and under the size limit. It is not a long-lived
option.

### Test plan

All queue tests use a temporary SQLite file (WAL needs a file, not `:memory:`) and an injected clock and id
generator. They need no network and no Redis.

| Area | Tests |
|---|---|
| Claim | FIFO with a `created_at` tie broken by `rowid`; `run_after` in the future is skipped; a canceled queued job is never claimed; a busy printer's next job waits while another printer's job is claimed |
| Concurrency | Two `Database` handles on one file claiming in alternation never return the same id; two `Bun.spawn` processes claiming 200 jobs between them claim each exactly once |
| Lease | Renewal extends `lease_until`; a renewal with a stale `lease_token` changes 0 rows and aborts the run; a status write after takeover is refused |
| Reaper | Not submitted: requeued with 5 s then 10 s backoff, then `failed` with the "lost the job" reason at `max_attempts`; submitted: left in flight, never requeued |
| Issue #5 | A fake transport counts `submit()` calls. Kill the worker after `submit` (stop renewing), advance the clock past the lease, start a second worker: `submit()` count stays 1 and `status()` resumes on the stored handle. If the resume fails, the job settles `failed` with the reconnect reason |
| Shutdown | `SIGTERM` requeues an unsubmitted job with no attempt counted and releases a printing job's lease at once |
| Cancel | The table in [Cancel](#cancel), case by case, mirroring `api/src/cancel.test.ts`; cancel racing a claim leaves exactly one of `canceled` or running |
| Events | `seq` increases; a write after a terminal state appends nothing; progress is coalesced to one event per second but every state change appears; retention removes only events of jobs terminal for over 7 days |
| Api | `GET /jobs/:id`, `/jobs/active`, `/jobs-history` and the WebSocket against a listener on `127.0.0.1:0`; the socket sends the snapshot, then events in order, and closes on terminal |
| Importer | A fake Redis reader with one job per row of the importer table produces the expected rows; a second run changes nothing |
| End to end | Compose in stub mode (`CONVEYOR_ENGINE_STUB=1`) with no `redis` service runs a job to `done`; `docker compose config` lists no `redis` |

Every new test is proven to bite: the PR reverts the line it covers and shows the test fail, as AGENTS.md §7
requires. Coverage must not drop, and the queue module targets at least 90% lines.

## Breakdown into PRs

Each PR stays at or under 800 changed lines, counted as AGENTS.md §4 counts them (pure deletions excluded),
and closes or references one issue.

| # | Title | Scope | Estimate |
|---|---|---|---|
| 1 | `feat(queue): sqlite job queue with leases and an event log` | `packages/shared/src/queue/`: the migration, enqueue, claim, renew, reaper, cancel, status write with the terminal guard, events tail, retention. Tests from the claim, concurrency, lease, reaper, cancel and events rows above. No callers yet. ADR 0004 records the decision. | ~650 |
| 2 | `fix(worker): run jobs from the sqlite queue and never resubmit after a restart` | Worker loop behind `CONVEYOR_QUEUE=sqlite`: claim and renew, `cancelRequested` from the row, status through the queue, the submit marker and resume path, `SIGTERM`, `stop_grace_period`. The issue #5 and shutdown tests. Closes #5 for the SQLite path. | ~700 |
| 3 | `feat(api): serve jobs from the sqlite queue` | Behind the same flag: enqueue, snapshot, active, history filter, cancel, and the WebSocket event-log tail. Api tests on `127.0.0.1:0`. | ~550 |
| 4 | `refactor(infra): make the sqlite queue the only queue and remove redis` | Flip the default and remove the flag, the Redis importer and its test, delete `bullmq`, `ioredis`, `StatusBus`, the Lua script and the Redis keys, drop `redis` from compose, update `self-hosting.md`, `DATA-MODEL.md`, `SEQUENCE.md` and the module pages. Mostly deletions. | ~450 added |
| 5 | `feat(infra): run the api and worker in one process` | `conveyor serve` and `conveyor work` entry points, the in-process `EventTarget` fast path, compose down to caddy, web and conveyor, one image for api and worker. | ~400 |

PRs 2 and 3 can be reviewed in parallel once PR 1 merges. PR 4 needs both. PR 5 needs PR 4.

## Risks

- **Write contention.** One writer at a time. Claims, renewals and status writes are single-row and short, and
  progress is coalesced, so even ten concurrent jobs stay under one write per 100 ms. `busy_timeout` absorbs
  bursts.
- **Clock.** Leases compare `Date.now()` across processes on one host, so they share a clock. A large NTP step
  can expire a lease early. The fencing token keeps that safe, at worst a reclaim.
- **Resume depends on the transport.** Moonraker and Elegoo both read status from a handle (`status(handle)`),
  but resuming after a restart has not been exercised against real hardware. The fallback is a clear
  `failed`, never a resubmit.
- **The submit-to-marker window** (see [Crash recovery](#worker-crash-recovery)) remains.
- **Cancel latency** rises from immediate to at most `cancelPollMs` (2 s) while printing.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep BullMQ and set `maxStalledCount: 0` (#5's second suggestion) | Fixes the double print by failing every interrupted job, keeps Redis and its five roles, and still allows two jobs on one printer |
| `bunqueue` or another SQLite queue package | 298 versions in 10 months from one maintainer is too much churn for the core path, and the queue is about 300 lines we can test fully |
| A separate `job_leases` table | See [Why the lease lives on the job row](#why-the-lease-lives-on-the-job-row) |
| SQLite `update_hook` to push events across processes | It only fires in the connection that wrote, so it cannot reach the api process; polling is needed there anyway |
| Postgres with `LISTEN`/`NOTIFY` and `SKIP LOCKED` | Adds a container, which is the opposite of the goal |
