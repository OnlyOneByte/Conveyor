# Design: a job queue in SQLite

Status: accepted, in progress. [ADR 0004](../adr/0004-sqlite-job-queue.md) records the decision. PRs 1 to 7 of
the [breakdown](#breakdown-into-prs) have landed (#125 to #146) and run behind `CONVEYOR_QUEUE=sqlite` plus
`CONVEYOR_QUEUE_UNSTABLE=1`. PRs 8 to 10 (the importer, removing Redis, one process) are not started, so Redis
stays the default. [Implementation deviations](#implementation-deviations) lists where the code differs from
this page.

Fixes [#5](https://github.com/OnlyOneByte/Conveyor/issues/5). Follows the queue sketch in the stack proposal
("Queue design (Option A)").

## Summary

Conveyor runs every job through BullMQ on Redis, and uses Redis for four more things: a status pub/sub bus,
a cancel flag and channel, a per-job snapshot, and an active-jobs set. All five move into the SQLite
database the api and worker already share (`/data/conveyor.db`, WAL mode). Redis and BullMQ are deleted.

Three outcomes:

1. **No code path sends g-code twice (#5).** The queue records a durable *intent* before `submit()` and a
   durable *marker* after it. A job with neither is safe to rerun. A job with the marker is resumed. A job
   with only the intent has an unknown outcome: it fails with "check the printer" and holds that printer
   until an operator releases it. It is never rerun.
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

- At most one `submit()` per job, across crashes, restarts, upgrades and stalls. When the queue cannot know
  whether the printer received a job, it stops and asks a person; it never guesses "no".
- Cancel behaves as it does today, including the HTTP codes the web client relies on and killing a running
  engine promptly.
- The web client keeps working unchanged: same routes, same `JobStatusEvent` frames on the WebSocket.
- At most one job per printer between "start sending" and "print finished". Jobs for a busy printer may
  still generate and slice ahead.
- The queue is testable with an injected clock and no network.

Non-goals:

- Multiple hosts. SQLite over NFS is unsafe; the queue supports several processes on one host sharing a local
  volume, and nothing more.
- Retrying a job whose pipeline failed. A `StageError` is terminal today and stays terminal. Retries cover
  only a lost worker, and only before the submit intent.
- Priorities, scheduled jobs and job dependencies. Nothing uses them.
- Moving the live channel from WebSocket to SSE. That belongs to the UI rewrite; the event log here supports
  both.
- Drizzle. The queue uses the same hand-written `bun:sqlite` style as `shared/src/db`.

## Schema

The queue extends the existing `jobs` table rather than adding a parallel one. Today a row is written only
when a job settles; from now on it is inserted at enqueue and updated through the job's life. A migration
step, guarded on the live table shape like the existing ones in `db/migrate.ts`, adds:

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
ALTER TABLE jobs ADD COLUMN submit_started_at   INTEGER;
ALTER TABLE jobs ADD COLUMN submitted_at        INTEGER;
ALTER TABLE jobs ADD COLUMN print_handle_json   TEXT;

ALTER TABLE printers ADD COLUMN hold_job_id TEXT;
ALTER TABLE printers ADD COLUMN hold_reason TEXT;
ALTER TABLE printers ADD COLUMN hold_at     INTEGER;

CREATE INDEX IF NOT EXISTS idx_jobs_claim  ON jobs (state, run_after, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease  ON jobs (state, lease_until);
CREATE INDEX IF NOT EXISTS idx_jobs_printer_live ON jobs (printer_id, state)
  WHERE state IN ('generating', 'slicing', 'transferring', 'printing');

CREATE TABLE IF NOT EXISTS job_events (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT    NOT NULL,
  event  TEXT    NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, seq);
```

- `state` keeps the existing `JobState` union: `queued`, `generating`, `slicing`, `transferring`, `printing`,
  `done`, `failed`, `canceled`. No state is added. A job is *preparing* in `generating` or `slicing` and
  *on the printer* in `transferring` or `printing`.
- `submit_started_at` is the intent and `submitted_at` the marker (see [Submitting](#submitting)).
- `printers.hold_*` blocks a printer after an outcome the queue cannot know (see
  [Printer holds](#printer-holds)).
- `event` is a serialized `JobStatusEvent`: exactly the frame the WebSocket sends today, so the api forwards it
  without reshaping it.
- Rows written before the migration are terminal history rows. The defaults leave them inert: `attempts` 0,
  no lease, no intent, no cancel.

### Why the lease lives on the job row

A separate `job_leases(job_id, owner, token, until)` table was considered. One job has at most one lease, so
a separate table adds a join to every claim and renewal, and adds a second row that can disagree with the
first. Keeping the lease on the row also makes the claim a single `UPDATE`. The cost is that `jobs` carries
queue columns that are `NULL` once the job settles. That is acceptable, and settling clears them.

### Connection settings

`openDb` keeps `journal_mode = WAL` and `busy_timeout = 5000`, and adds `synchronous = NORMAL`. Under WAL,
`NORMAL` skips the fsync on each commit and syncs at checkpoints instead. It cannot corrupt the database. A
power cut can lose the last few commits, though, and two writes must survive one: the submit intent and the
submit marker. Those two run with `synchronous = FULL` on the writing connection, set before the transaction
and reset after it. Everything else (progress, renewals, events) runs at `NORMAL`. A lost progress row costs
nothing.

Implementation note: `synchronous` is a per-connection setting, and the worker shares one connection across
its jobs. A helper sets `FULL`, runs the transaction and resets `NORMAL` in one synchronous block, with no
`await` between the three. The reset sits in a `finally`. `bun:sqlite` is synchronous, so no other job's
write can run on the connection while it is at `FULL`, and a throwing transaction cannot leave it there.

## Leases and fencing

A lease is the triple `(lease_owner, lease_token, lease_until)` on the job row. Three rules make it a fence.

1. **Every takeover bumps the token.** The claim, the reaper and a worker releasing its own lease all set
   `lease_token = lease_token + 1`. No statement hands a lease from one owner to another without bumping it.
2. **Every worker write checks it still owns a live lease.** Each worker write for a job carries
   `AND lease_owner = ?me AND lease_token = ?token AND lease_until >= ?now`. That covers renew, status,
   intent, marker, settle and release. A write that changes 0 rows means the lease is gone, and the worker
   stops working on that job.
3. **No worker write clears a lease, except settling and releasing.** Status, intent and marker writes leave
   `lease_owner` and `lease_until` as they are.

`lease_until >= ?now` also makes a worker fence itself. A worker that stalled past its own lease (a GC pause,
`SIGSTOP`, an NTP step, renewals stuck on `SQLITE_BUSY`) cannot write, even before the reaper has run.

### Invariant: no in-flight row without a lease, except a resumable one

An in-flight row is one in `generating`, `slicing`, `transferring` or `printing`. At every commit, each such
row is in exactly one of these shapes:

| Shape | Columns | Who moves it next |
|---|---|---|
| Leased | `lease_owner`, `lease_until` set | its owner, or the reaper once `lease_until < now` |
| Resumable orphan | lease cleared, `submitted_at` set, state `transferring` or `printing` | the next claim (it resumes monitoring) |

Each statement that writes an in-flight state, and why it keeps the invariant:

| Statement | Writes | Keeps the invariant because |
|---|---|---|
| Claim | sets an in-flight state and a full lease | it sets all three lease columns |
| Worker status, intent, marker | in-flight state | rule 2 requires a live lease; rule 3 keeps it |
| Worker release on `SIGTERM` | clears the lease | it requeues the job, or leaves it a resumable orphan only when `submitted_at` is set; otherwise it waits for the submit to finish |
| Reaper | clears the lease | it moves the row to `queued`, to `failed`, or to a resumable orphan only when `submitted_at` is set |

A stalled worker that wakes after the reaper ran fails rule 2 (the token moved) and writes nothing, so it
cannot leave a lease-less row in flight. As a backstop against a bug in that reasoning, the reaper also
matches in-flight rows with `lease_owner IS NULL AND submitted_at IS NULL`. It settles them `failed` and
holds the printer when `submit_started_at` is set. A test asserts the invariant after every step of the
scenarios in the [test plan](#test-plan).

### Why a printer cannot get stuck

A printer is blocked while some job is on it (`transferring` or `printing`), or while it has a hold. Each way
out:

- **A live lease:** the job finishes, fails or is canceled, and settling clears it.
- **A dead worker:** the lease expires within `leaseMs` (30 s). The reaper then turns the job into a resumable
  orphan (marker set) or settles it and holds the printer (intent only). An orphan is claimed on the next
  claim tick. If resuming fails, it settles `failed` and holds the printer.
- **A hold:** an operator releases it with `POST /catalog/printers/:id/release` (see [Printer holds](#printer-holds)).
  A hold is deliberate. It is the one wait that needs a person, and it says so in the printer's status and the
  failed job's reason.

No state needs a process that no longer exists to make progress.

### Renewal

- `leaseMs` defaults to 30 s. Each running job's lease is renewed every 10 s:
  `UPDATE jobs SET lease_until = ?now + ?leaseMs WHERE id = ? AND lease_owner = ?me AND lease_token = ? AND lease_until >= ?now`.
- Renewal runs on a timer independent of the stage. Engines run through `Bun.spawn` and printers through
  async I/O, so the event loop stays free to renew during a long slice or print.
- **`SQLITE_BUSY` is not a lost lease.** If a renewal still gets `SQLITE_BUSY` after `busy_timeout`, it is
  retried every 1 s until 5 s before `lease_until`. If it has not succeeded by then, the worker treats the
  lease as lost and stops. Only `changes() = 0`, or running out of time, counts as lost.
- A lost lease aborts the job's `AbortController` with `LeaseLostError`. The run unwinds and writes nothing:
  every write it attempts is fenced. When the job is past the submit intent, the abort does not stop the
  printer. Whoever holds the job next decides, through resume or a hold.

## Claiming

### Enqueue

`POST /jobs` keeps its validation and inserts the row in one statement:

```sql
INSERT INTO jobs (id, generator_id, params_json, printer_id, profile_id, state, run_after, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'queued', ?now, ?now, ?now);
```

It inserts the first `queued` event in the same transaction, then returns `202 { jobId }` as today.

### Atomic claim

`bun:sqlite`'s `db.transaction(fn)` opens a deferred `BEGIN`. The claim, the reaper, slot acquisition and the
queued-cancel all use `db.transaction(fn).immediate()`, which issues `BEGIN IMMEDIATE`. It takes the write
lock before the first read, so the selecting subquery and the update see the same snapshot. A test asserts
these entry points run immediate transactions.

```sql
UPDATE jobs
   SET state       = CASE WHEN submitted_at IS NULL THEN 'generating' ELSE state END,
       attempts    = CASE WHEN submitted_at IS NULL THEN attempts + 1 ELSE attempts END,
       lease_owner = ?me, lease_token = lease_token + 1,
       lease_until = ?now + ?leaseMs, updated_at = ?now
 WHERE id = (
   SELECT j.id FROM jobs j
    WHERE (    (j.state = 'queued' AND j.run_after <= ?now AND j.cancel_requested_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM jobs p
                                 WHERE p.printer_id = j.printer_id AND p.id <> j.id
                                   AND p.state IN ('generating', 'slicing'))
                AND NOT EXISTS (SELECT 1 FROM printers pr
                                 WHERE pr.id = j.printer_id AND pr.hold_job_id IS NOT NULL))
            OR (j.state IN ('transferring', 'printing') AND j.lease_owner IS NULL
                AND j.submitted_at IS NOT NULL))
    ORDER BY j.submitted_at IS NULL, j.created_at, j.rowid
    LIMIT 1)
RETURNING *;
```

- **Two kinds of row.** A `queued` job starts at `generating` and counts an attempt. A resumable orphan keeps
  its state and is resumed (see [Crash recovery](#worker-crash-recovery)). Orphans sort first.
- **One job prepares ahead per printer, and none for a held one.** The first `NOT EXISTS` lets a queued job
  start only when no other job for its printer is generating or slicing. So a printer has at most one job on
  it and one preparing. The second keeps a held printer's queued jobs in `queued`. A job that was already
  preparing when the hold was set finishes slicing and waits at the slot. No new one is claimed for that
  printer until the hold is released.
- **The cap counts engine work only.** `WORKER_CONCURRENCY` (default 2, as today) limits how many of a
  worker's jobs are running an engine: generating, or slicing with the slice not yet done. Three kinds of job
  do not count, because they hold no engine and use only a timer and a socket:
  - a job waiting at the [printer slot](#printer-slot);
  - a job transferring or printing;
  - a resumed orphan.

  So a busy or held printer never uses up the capacity other printers need. The waiting jobs are bounded too:
  at most one per printer, from the prepare-ahead rule.
- **Idle polling is cheap.** A worker with engine capacity free checks every `claimIdleMs` (default 1 s) with
  a read-only `SELECT EXISTS` over the same conditions. It takes the write lock only when that finds a
  candidate. When a job leaves engine work, it checks again at once. A resumable orphan is claimed whatever
  the engine count, because resuming starts no engine.

### Printer slot

The per-printer lock covers only sending and printing. A job leaves `slicing` for `transferring` through one
immediate transaction:

```sql
UPDATE jobs SET state = 'transferring', updated_at = ?now
 WHERE id = ? AND lease_owner = ?me AND lease_token = ? AND lease_until >= ?now
   AND NOT EXISTS (SELECT 1 FROM jobs o WHERE o.printer_id = jobs.printer_id AND o.id <> jobs.id
                     AND o.state IN ('transferring', 'printing'))
   AND NOT EXISTS (SELECT 1 FROM printers pr WHERE pr.id = jobs.printer_id AND pr.hold_job_id IS NOT NULL);
```

When it changes 0 rows and the lease is still live, the printer is busy or held. The job stays in `slicing`
with `progress = 1` and `message = 'sliced; waiting for the printer'`, and retries every `claimIdleMs`,
renewing its lease as usual. From that point it no longer counts against `WORKER_CONCURRENCY`. Cancel works
while it waits. A dedicated waiting state was considered and left
out: it would change the shared `JobState` union that the web client renders, for a message that says the
same thing.

### Retries and backoff

Only a lost worker before the submit intent causes a retry. The reaper runs on every worker's claim tick and
once at startup, in one immediate transaction. In it, every row it takes over gets
`lease_owner = NULL, lease_until = NULL, lease_token = lease_token + 1`. It matches in-flight rows whose
`lease_until < ?now`, plus two backstops:

- in-flight rows with `lease_owner IS NULL AND submitted_at IS NULL`;
- in-flight rows with `lease_until > ?now + ?leaseMs`. No renewal writes a lease that far ahead, so such a row
  was written before a backward clock step. Without this backstop, a dead worker's job would wait out the
  size of the step.

Resumable orphans (no lease, marker set) match none of these and are left for the claim. A live worker
caught by the clock backstop is fenced like a stalled one and stops, at the cost described under
[Risks](#risks). Each matched row gets one outcome:

| Row | Outcome |
|---|---|
| `submit_started_at IS NULL`, `attempts < max_attempts` | `queued`, `run_after = now + 5 s * 2^(attempts - 1)` (5 s, then 10 s) |
| `submit_started_at IS NULL`, attempts exhausted | `failed`: `worker lost the job <n> times before it reached the printer` |
| `submit_started_at` set, `submitted_at IS NULL` | `failed` and the printer held: `worker stopped while sending the job to the printer; check the printer before releasing it` |
| `submitted_at` set | a resumable orphan: state kept, lease cleared, token bumped |

Each transition appends a `job_events` row. Each `failed` settles history exactly as `settle.ts` does,
including `notes`. Regenerating and re-slicing in the first row are safe, because nothing has reached the
printer.

## Behaviour

### Submitting

`printStage` becomes four fenced steps:

1. **Take the printer slot** (above). The state becomes `transferring`.
2. **Write the intent:** `submit_started_at = now`, with `synchronous = FULL`. Steps 1 and 2 are one
   transaction.
3. **Call `transport.submit()`** (upload plus `print/start`).
4. **Write the marker:** `submitted_at = now, print_handle_json = ?handle`, with `synchronous = FULL`.

What each crash point leaves behind:

| The worker dies | Row afterwards | Next |
|---|---|---|
| Before step 2 commits | no intent | requeued; nothing reached the printer |
| After step 2, during or after step 3, before step 4 commits | intent, no marker | `failed`, printer held |
| After step 4 | marker | resumed |

`submit()` raising `PrintNotStartedError` (a transport's "the printer never got it") clears the intent in the
same fenced write that settles the job `failed`. No hold is set, because the transport knows the outcome.

### Printer holds

A hold means "the printer may be busy with a job the queue has lost track of". It is set in the same
transaction that settles the job, as `hold_job_id = ?job, hold_reason = ?text, hold_at = ?now`, in three
cases:

- the reaper finds an intent with no marker;
- a resume fails;
- a stop fails for a job whose intent is set (see [Cancel](#cancel)).

While a printer is held:

- no queued job for it is claimed, so nothing prepares ahead for a printer that may never be free;
- the printer slot refuses every job for it, which covers a job already preparing when the hold was set;
- other printers are unaffected: the held printer's jobs neither run nor count against `WORKER_CONCURRENCY`.

`POST /catalog/printers/:id/release` clears it. The operator calls it after checking the printer. It is an
authenticated route like the rest of the api, and it needs a confirmation flag (`{ "confirm": true }`) so a
stray request cannot release a hold. A hold is never released automatically: probing the printer cannot tell
"idle" from "about to start the job we sent".

Until the UI rewrite adds a button, `docs/self-hosting.md` carries this runbook. When `CONVEYOR_AUTH` is on, it
logs in first and keeps the session cookie in a private temporary file:

```sh
jar=$(mktemp)
read -rs CONVEYOR_PW
printf '{"password":"%s"}' "$CONVEYOR_PW" |
  curl -fsS -c "$jar" -H 'content-type: application/json' --data-binary @- https://conveyor.example/auth/login
curl -fsS -b "$jar" -H 'content-type: application/json' -d '{"confirm":true}' \
  https://conveyor.example/catalog/printers/<printer-id>/release
rm -f "$jar"; unset CONVEYOR_PW
```

`read -rs` keeps the password out of the shell history and the process list. The runbook notes that a
password containing `"` or `\` must be JSON-escaped. With auth off, only the second `curl` is needed, without
`-b`.

### Cancel

`POST /jobs/:id/cancel` keeps today's contract, from `api/src/cancel.ts`. One immediate transaction decides by
the row's state:

| State when cancel arrives | Today | With the SQLite queue |
|---|---|---|
| Terminal | `200` with that state | Same; nothing is written |
| No row | `404 unknown job` | Same |
| `queued` (BullMQ `waiting`, `delayed`) | Job removed, `canceled` published and recorded, `200 canceled` | `SET state = 'canceled', cancel_requested_at = ?now WHERE state = 'queued'` plus a `canceled` event, `200 canceled` |
| In flight | Cancel flag and control message, `202 canceling` | `SET cancel_requested_at = ?now`, `202 canceling` |
| Snapshot exists but BullMQ lost the job | Flag set, `202 canceling` | Cannot happen: the row is the job |

**Prompt abort in every stage.** Today the control message calls `controller.abort()` at once. That reaches
`ctx.signal`, and the generator and slicer pass `ctx.signal` to `Bun.spawn`, so a cancel kills a running
engine. The queue keeps that. Each running job has one run timer that ticks every `cancelPollMs` (1 s). Each
tick reads `cancel_requested_at`, a read-only indexed lookup, and calls `controller.abort()` when it is set.
It renews the lease on every tenth tick. The timer runs from claim to settle, so a cancel during a long slice
kills the slicer within 1 s. It replaces the print stage's own cancel poll. `PipelineDeps.cancelRequested()`
reads the same column, so stage checkpoints behave as now.

From there, `settle.ts` does what it does today: it stops the printer when the job had reached it, and
writes `canceled`, or `failed` when the printer refuses to stop. A cancel during step 3 of
[Submitting](#submitting) aborts the submit the same way today's does. That is an operator's explicit
choice, and `stopPrinter` runs.

**A failed stop after the intent holds the printer.** Settling `failed` because the printer did not confirm
the stop frees the printer slot, but the printer may still have the job. This is most likely after a cancel
during step 3, when an upload or `print/start` may have landed. So whenever `stopPrinter` fails for a job
whose `submit_started_at` is set, the same transaction that settles it `failed` holds the printer, with the
reason `cancel requested but the printer did not confirm the stop; check the printer before releasing it`.
A failed stop before the intent cannot happen: `stopPrinter` only runs once the job has reached the printer.

The queued-cancel `UPDATE` and the claim both take the write lock, so a job is either claimed or canceled,
never both. The claim's `cancel_requested_at IS NULL` filter covers a cancel that lands between a requeue
and the next claim. The 7-day cancel-flag TTL goes away: the flag lives on the row, which is kept as history.

### Worker crash recovery

This is the fix for #5.

1. Steps 2 and 4 of [Submitting](#submitting) bracket `submit()` with durable writes.
2. The worker dies (OOM, `docker compose up -d`, a reboot). Renewals stop, and `lease_until` passes.
3. The reaper applies its table: requeue before the intent, fail and hold between intent and marker, orphan
   after the marker.
4. The next claim takes an orphan and enters `watchPrint` directly with the stored handle, skipping
   generate, slice and submit. It publishes a `printing` event whose `message` reads
   `resumed after worker restart`.
5. If the transport cannot resume (no `status()` for a stored handle, or the first status read fails), the
   job settles `failed` with
   `worker restarted mid-print and could not reconnect; check the printer before releasing it`, and holds
   the printer. It is never resubmitted.

No crash point leads to a second `submit()`. The cost of that guarantee is a held printer after a crash
during the upload window, which is the case that needs a person to look at the printer anyway.

### Graceful shutdown

On `SIGTERM` the worker stops claiming and, per running job:

| Where the job is | What the worker does |
|---|---|
| Before the intent (generating, slicing, waiting for the slot) | aborts the run, then, fenced, requeues it with `run_after = now`, the attempt not counted and the token bumped |
| Between intent and marker (inside `submit()`) | lets `submit()` finish and writes the marker, then releases as below |
| After the marker | releases the lease (owner and until cleared, token bumped), so the next worker resumes at once. The print is not touched |

Compose sets `stop_grace_period: 60s`. That covers a g-code upload to a printer on the local network. If the
grace period runs out during `submit()`, the process is killed with the intent written and no marker, and the
reaper fails the job and holds the printer, as for any crash in that window.

### Ordering

- FIFO by `created_at`, with `rowid` as the tie-break for jobs enqueued in the same millisecond. Resumable
  orphans go first.
- Per printer: at most one job on the printer and one preparing. Jobs reach the printer in the order they
  finished slicing. That is FIFO except when an earlier job fails or is canceled.
- Other printers are never blocked by a busy or held one. A busy printer's jobs use at most one engine slot
  (its single preparing job), and its waiting and printing jobs use none. A held printer's jobs use none
  once its preparing job, if any, finishes slicing. So a job for an idle printer waits at most for one engine
  slot to free, never for a print to end.
- `WORKER_CONCURRENCY` caps engine work only (see [Atomic claim](#atomic-claim)). Today it caps every job a
  worker holds, printing ones included, so two long prints can block every other printer. That is a deliberate
  change.

## Live status

### Writes

Every status change the worker publishes today through `StatusBus.publish` becomes one fenced transaction:

```sql
UPDATE jobs SET state = ?, stage = ?, progress = ?, message = ?, timings_json = ?, updated_at = ?now
 WHERE id = ? AND lease_owner = ?me AND lease_token = ? AND lease_until >= ?now
   AND state NOT IN ('done', 'failed', 'canceled');
INSERT INTO job_events (job_id, event, at) SELECT ?, ?, ?now WHERE changes() = 1;
```

- The guard replaces the Lua script's "never overwrite a terminal snapshot". A late `printing` event after
  `canceled` changes nothing and appends nothing.
- **Progress is coalesced before it reaches the database.** `ctx.report()` can fire many times a second. The
  worker keeps the latest progress in memory and flushes it at most once per `progressFlushMs` (1 s) per job,
  as one row update plus one event. A state or stage change flushes at once and is never dropped. So a
  printing job costs at most one progress write per second, and a renewal every 10 s.

### Reads

| Route | Today | With the SQLite queue |
|---|---|---|
| `GET /jobs/:id` | Redis snapshot | The row, mapped to `JobStatusEvent` |
| `GET /jobs/active` | Set plus snapshots, pruned | `SELECT ... WHERE state NOT IN (terminal) ORDER BY updated_at DESC` |
| `GET /jobs/:id/ws` | Redis subscription | Snapshot, then the event-log tail, below |
| `GET /jobs-history` | Terminal rows | Unchanged, filtered to terminal states so queued jobs do not appear early |

### The event-log tail

**Snapshot and cursor are read atomically.** When a socket opens, the handler reads the row and
`MAX(seq)` for the job inside one read transaction (`BEGIN` ... `COMMIT`, deferred). Under WAL, both reads
see the same committed state. A status write cannot land between them, so the tail that starts after that
cursor neither drops nor repeats an event. It then tails:

```sql
SELECT seq, event FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT 100;
```

- **Two processes** (until the last PR): the api polls each open socket every 250 ms while events keep
  arriving, backing off to 1 s after 5 s with nothing new. In WAL mode readers never block the writer, and the
  query is an index range scan on `(job_id, seq)` that takes no write lock. That is cheap even on a Pi.
- **One process** (last PR): the queue module exposes an in-process `EventTarget`. Every committed event
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
| Until Redis is removed | api and worker share `/data/conveyor.db` | caddy, web, api, worker (redis until PR 9) |
| Last PR | `conveyor serve` runs the api and an in-process worker; `conveyor work` runs a worker alone | caddy, web, conveyor |
| UI rewrite (separate) | the app serves the SPA too | conveyor, plus optional caddy |

SQLite must be on a local volume, and `docs/self-hosting.md` says so. The api and worker share one database
file, so they must run on the same host.

## Rollout

### Switching between the two stacks

`CONVEYOR_QUEUE=redis|sqlite` (default `redis`) selects the stack while both exist. Compose passes one
`${CONVEYOR_QUEUE:-redis}` value to both the api and the worker, so in a normal install they cannot
disagree. The api and the worker each log the selected mode at startup.

- `sqlite` is only coherent once the worker PRs (5 and 6) **and** the api PR (7) have all merged. A
  `sqlite` worker with a `redis` api never sees a job, and the reverse never runs one.
- Until PR 7 merges, `sqlite` is undocumented, and the worker refuses to start in that mode unless
  `CONVEYOR_QUEUE_UNSTABLE=1` is also set. Only tests and the developers of PRs 5 to 7 set it.
- The guard outlived PR 7: both the api and the worker still refuse `sqlite` without
  `CONVEYOR_QUEUE_UNSTABLE=1` (`packages/shared/src/queue-mode.ts`). PR 9 makes `sqlite` the default, deletes
  the Redis path and removes both flags.

### Migrating from Redis

Default: **drain, then upgrade.** `docs/self-hosting.md` tells the operator to wait until `/jobs/active` is
empty. For queued jobs that should survive the upgrade, PR 8 ships a one-shot importer,
`bun run --cwd packages/worker migrate-redis`. It runs only when `REDIS_URL` is set.

It **refuses to run**, and changes nothing, in two cases:

- **The old BullMQ worker might still be running:** the queue has a live worker (BullMQ's worker list is not
  empty) or any job lock key exists. The message tells the operator to stop the `worker` service first.
- **A job is on a printer:** any snapshot is `transferring` or `printing`, or any BullMQ job is `active`. The
  message lists those jobs and their printers and says to let them finish or cancel them first.

It refuses rather than holding those printers' queues. A hold needs a stored print handle to resume from or
a person to release it, and Redis has no handle. So importing an in-flight print would always end in a held
printer and a manual release. Asking the operator to wait for the print is simpler and leaves nothing
half-imported. The refusal costs a wait, never a collision.

When neither refusal applies:

| Redis state | Imported as |
|---|---|
| BullMQ `waiting`, `delayed`, `prioritized` | `queued` rows, in their BullMQ order, with their original ids |
| Snapshot terminal | Skipped: it is already in SQLite history |
| Cancel flag on a waiting job | Imported as `canceled` |

The importer is idempotent (`INSERT ... ON CONFLICT(id) DO NOTHING`), prints one line per job, and exits
non-zero when Redis is unreachable. It is deleted one release after PR 9.

### Test plan

All queue tests use a temporary SQLite file (WAL needs a file, not `:memory:`) and an injected clock and id
generator. They need no network and no Redis. A helper asserts the
[lease invariant](#invariant-no-in-flight-row-without-a-lease-except-a-resumable-one) over every row after each
step of every scenario.

| Area | Tests |
|---|---|
| Claim | FIFO with a `created_at` tie broken by `rowid`; `run_after` in the future is skipped; a canceled queued job is never claimed; a second job for a printer may claim while the first prints, but a third waits while the second prepares; no queued job is claimed for a held printer; orphans are claimed first, even with every engine slot in use |
| Two printers | With `WORKER_CONCURRENCY=1`: job A1 prints on printer A and A2 waits at A's slot, and B1 for printer B is still claimed, slices and prints. With A held and A2 queued, B1 is claimed and A2 stays `queued`. After the hold is released, A2 is claimed. The engine count never exceeds 1, and the waiting and printing jobs never count toward it |
| Immediate transactions | The claim, reaper, slot and queued-cancel entry points open `BEGIN IMMEDIATE` (checked through a spy on the connection's `exec`) |
| Concurrency | Two `Database` handles on one file claiming in alternation never return the same id; two `Bun.spawn` processes claiming 200 jobs between them claim each exactly once |
| Fencing | After the reaper takes a lease, every write from the old owner (status, intent, marker, settle, release) changes 0 rows; a worker past its own `lease_until` cannot write before the reaper runs; a stalled worker that wakes after a reaper requeue leaves the row `queued` with no lease, and the invariant holds |
| Renewal | Renewal extends `lease_until`; `SQLITE_BUSY` (simulated by holding a write lock on a second handle) is retried and succeeds once released; one still busy 5 s before expiry aborts the run |
| Reaper | Each row of the reaper table, including the 5 s and 10 s backoff, the backstop for a lease-less in-flight row, and the clock backstop: a lease 2 × `leaseMs` ahead of the clock is taken over, and one exactly `leaseMs` ahead is not |
| Printer slot | A second job waits in `slicing` with the waiting message while the first is on the printer, and takes the slot when it settles; a held printer refuses the slot; cancel while waiting settles `canceled` |
| Issue #5, crash | A fake transport counts `submit()` calls. Kill the worker (stop renewing, no settle) at each of the three crash points in [Submitting](#submitting), advance the clock past the lease, start a second worker. Before the intent: requeued and submitted once. Intent only: `failed`, printer held, `submit()` count 1, the next job for that printer waits. After the marker: resumed on the stored handle, count 1 |
| Resume failure | A transport whose `status()` rejects on resume settles `failed` with the reconnect reason and holds the printer |
| Hold release | `POST /catalog/printers/:id/release` without `confirm` is `400`; with it, the hold clears and the waiting job takes the slot |
| Shutdown | `SIGTERM` requeues a slicing job (attempt not counted); waits for a `submit()` in progress, writes the marker, then releases; releases a printing job so a second worker resumes at once; a grace timeout inside `submit()` ends in a hold |
| Cancel | The table in [Cancel](#cancel), case by case, mirroring `api/src/cancel.test.ts`; a cancel during a 10 s fake slice aborts `ctx.signal` within 1.5 s of the clock; a cancel racing a claim leaves exactly one of `canceled` or running; a cancel during `submit()` whose `stopPrinter` fails settles `failed` and holds the printer, and the next job for it waits |
| Writes | 100 `ctx.report()` calls in one second produce one row update and one event; every state change produces an event; a write after a terminal state appends nothing |
| Durability | The intent and marker writes run with `synchronous = FULL`, and other writes with `NORMAL` (checked through `PRAGMA synchronous` on the connection inside each write); a `FULL` transaction that throws leaves the connection back at `NORMAL` |
| Events and tail | `seq` increases; a status write injected between snapshot and cursor (through a hook in the test) is delivered exactly once; the poll backs off after 5 s idle; retention removes only events of jobs terminal for over 7 days |
| Api | `GET /jobs/:id`, `/jobs/active`, `/jobs-history`, the WebSocket and the hold release against a listener on `127.0.0.1:0` |
| Importer | Refuses with a live BullMQ worker, a lock key, an `active` job, or a `transferring` or `printing` snapshot, and writes nothing; otherwise imports each row of its table; a second run changes nothing |
| Switch | The worker refuses `CONVEYOR_QUEUE=sqlite` without `CONVEYOR_QUEUE_UNSTABLE=1` before PR 7; compose passes one value to both services |
| End to end | Compose in stub mode (`CONVEYOR_ENGINE_STUB=1`) with no `redis` service runs a job to `done`; `docker compose config` lists no `redis` |

Every new test is proven to bite: the PR reverts the line it covers and shows the test fail, as AGENTS.md §7
requires. Coverage must not drop, and the queue module targets at least 90% lines.

## Breakdown into PRs

AGENTS.md §4 caps a PR at 400 changed lines; 401 to 800 is an S2 with a request to split. Each code PR below
is planned under 400. Tests count toward the limit, which is what makes some of them close. PR 6 is the one
most likely to go over. If it does, it asks for `large-ok` rather than splitting the submit steps from their
crash tests, because the tests are what prove #5 is fixed.

| # | Title | Scope | Estimate |
|---|---|---|---|
| 1 | `feat(queue): add the sqlite job queue schema and atomic claim` | `packages/shared/src/queue/`: migration (columns, indexes, `job_events`, printer holds, `synchronous`), enqueue, claim with orphans, the per-printer prepare cap and the hold check, immediate-transaction helper. Claim, immediate and concurrency tests. ADR 0004 records the decision | ~380 |
| 2 | `feat(queue): fence leases with renewal and a reaper` | Renew with the `SQLITE_BUSY` retry, release, the reaper table and backstop, the invariant helper. Fencing, renewal and reaper tests | ~390 |
| 3 | `feat(queue): guard status writes and tail the event log` | Fenced status write with the terminal guard, progress coalescing, events, snapshot-plus-cursor read, tail query, retention. Writes and events tests | ~360 |
| 4 | `feat(queue): cancel, printer slot and printer holds` | Queued and in-flight cancel, slot acquisition, hold set and release functions. Cancel (queue side), slot and hold tests | ~330 |
| 5 | `feat(worker): run jobs from the sqlite queue behind a flag` | Worker loop: claim with the engine-only `WORKER_CONCURRENCY` count, the run timer (cancel every 1 s, renew every 10 s), status through the queue, settle through the queue, behind `CONVEYOR_QUEUE=sqlite` plus `CONVEYOR_QUEUE_UNSTABLE=1` | ~370 |
| 6 | `fix(worker): never resubmit after a restart` | Slot, intent, marker, resume, holds on an unknown outcome and on a failed stop after the intent, `SIGTERM`, `stop_grace_period`. The #5 crash, resume failure, two-printer and shutdown tests. Closes #5 | ~400, may ask for `large-ok` |
| 7 | `feat(api): serve jobs from the sqlite queue` | Enqueue, snapshot, active, history filter, cancel, the WebSocket tail and `POST /catalog/printers/:id/release`, behind the flag; removes the unstable guard and documents the flag. Api and switch tests | ~390 |
| 8 | `feat(worker): import queued jobs from redis` | The importer with both refusals, its tests, and the upgrade runbook in `self-hosting.md` | ~300 |
| 9 | `refactor(infra): make the sqlite queue the only queue and remove redis` | Default to SQLite and remove the flag; delete `bullmq`, `ioredis`, `StatusBus`, the Lua script and the Redis keys; drop `redis` from compose; update `DATA-MODEL.md`, `SEQUENCE.md` and the module pages. Mostly deletions, which §4 does not count | ~250 added |
| 10 | `feat(infra): run the api and worker in one process` | `conveyor serve` and `conveyor work`, the in-process `EventTarget` fast path, compose down to caddy, web and conveyor | ~350 |

Order: 1, then 2, 3 and 4 in any order; 5 needs 2 and 3; 6 needs 4 and 5; 7 needs 3 and 4 and can be reviewed
beside 5 and 6; 8 needs 7; 9 needs 6, 7 and 8; 10 needs 9.

## Implementation deviations

Where the landed code differs from this page. [modules/worker.md](../modules/worker.md) describes the code as
it is.

| This page says | The code does |
|---|---|
| Idle polling runs a read-only `SELECT EXISTS` and takes the write lock only on a hit ([Atomic claim](#atomic-claim)) | An idle worker takes the write lock for every claim attempt |
| A resumable orphan is claimed whatever the engine count | An orphan is claimed only while an engine slot is free, because `claimJob` cannot ask for orphans alone |
| `PrintNotStartedError` clears the intent and sets no hold ([Submitting](#submitting)) | Every failed `submit()`, `PrintNotStartedError` included, settles `failed` inside the upload window and holds the printer |
| PR 7 removes the `CONVEYOR_QUEUE_UNSTABLE` guard | The guard stays until PR 9 ([Switching between the two stacks](#switching-between-the-two-stacks)) |
| While a printer is held, `GET /catalog/printers` and the printer's status show the hold and its reason ([Printer holds](#printer-holds)) | No route returns the hold: `GET /catalog/printers` returns `dbListPrinters(openDb())`, which reads no `hold_*` column, and nothing outside the queue module reads `hold_*` |

## Risks

- **Write rate.** Per running job: at most one coalesced progress write per second, one renewal per 10 s, and
  one-off state changes. Cancel checks and idle claim probes are reads. With the default
  `WORKER_CONCURRENCY` of 2, that is about 2.2 writes per second, each a short single-row transaction at
  `synchronous = NORMAL` with no fsync per commit. Ten concurrent jobs stay near 11 writes per second.
  `busy_timeout` absorbs bursts. The two `FULL` writes per job (intent and marker) add two fsyncs per print.
- **Clock.** Leases compare `Date.now()` across processes on one host, so they share a clock.
  - A large forward NTP step can expire leases early.
  - A backward step leaves leases further ahead than one lease length, and the reaper's clock backstop then
    takes them over at once, live ones included.

  Fencing makes both safe: the old owner stops writing. The cost is the same in both directions: a requeue
  before the intent, a resume after the marker, or a hold when the step landed inside `submit()`.
- **Resume depends on the transport.** Moonraker and Elegoo both read status from a handle (`status(handle)`),
  but resuming after a restart has not been exercised against real hardware. The fallback is a `failed` job
  and a held printer, never a resubmit.
- **Holds need a person.** A crash during the upload window, or a stop the printer refuses after the intent,
  holds the printer until someone releases it. That is deliberate, but until the UI rewrite the release is the
  login-then-release `curl` from the runbook.
- **Cancel latency** is at most `cancelPollMs` (1 s) in every stage, against effectively immediate today.
- **Power loss** at `synchronous = NORMAL` can drop the last progress updates. The intent and marker are
  written at `FULL`, so they cannot be lost that way.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep BullMQ and set `maxStalledCount: 0` (#5's second suggestion) | Fails every interrupted job, including ones safe to rerun. Keeps Redis and its five roles, and still allows two jobs on one printer |
| `bunqueue` or another SQLite queue package | 298 versions in 10 months from one maintainer is too much churn for the core path, and the queue is small enough to test fully |
| A separate `job_leases` table | See [Why the lease lives on the job row](#why-the-lease-lives-on-the-job-row) |
| Per-printer lock across the whole run | Simpler, but a job could not even start slicing until the previous multi-hour print ended |
| A new `waiting_printer` job state | Clearer in the UI, but it changes the shared `JobState` union for what a message already says (see [Printer slot](#printer-slot)) |
| Probing the printer to auto-release a hold | A printer about to start the job we sent looks idle, so a probe cannot tell the safe case from the dangerous one |
| Importing in-flight prints with a printer hold | See [Migrating from Redis](#migrating-from-redis): with no stored handle it always ends in a manual release |
| SQLite `update_hook` to push events across processes | It only fires in the connection that wrote, so it cannot reach the api process; polling is needed there anyway |
| Postgres with `LISTEN`/`NOTIFY` and `SKIP LOCKED` | Adds a container, which is the opposite of the goal |
