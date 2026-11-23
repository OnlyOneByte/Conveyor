# ADR 0004 — A job queue in SQLite instead of BullMQ and Redis

- **Status:** Accepted, rollout in progress
- **Date:** 2026-11-21

## Context

Every job runs through BullMQ on Redis, and Redis also carries the status bus, the cancel flag and channel, a per-job snapshot and the active-jobs set. A worker restart mid-print can rerun the job and send the g-code to the printer again (#5). The snapshot, the active set and the history can disagree, and self-hosting needs a `redis` container for state the api and worker already share a SQLite database for. The full analysis is in [design/sqlite-queue.md](../design/sqlite-queue.md).

## Decision

- **Move the queue and its four side roles into the shared SQLite database.** Leases live on the `jobs` row and are fenced by a token, so a worker that lost its lease writes nothing. Live status goes to a `job_events` table that the api polls.
- **Never resubmit on an unknown outcome.** The queue records a durable intent before `submit()` and a marker after it. A job with neither is requeued, a job with the marker is resumed, and a job with only the intent fails and holds the printer until an operator releases it.
- **Roll out behind a flag.** `CONVEYOR_QUEUE=sqlite` plus `CONVEYOR_QUEUE_UNSTABLE=1` selects the new path. Redis stays the default until the importer lands, then the Redis path is deleted.

## Consequences

- A crash inside the upload window needs a person: `POST /catalog/printers/:id/release` with `{ "confirm": true }`, run from the runbook until the UI has a button.
- Cancel waits for a poll, at most 1 s, instead of a pub/sub message.
- Until Redis is removed, both queues ship and both paths need tests.
- Rejected: keeping BullMQ with `maxStalledCount: 0` (fails every interrupted job and keeps Redis), a SQLite queue package (too much churn for the core path), and Postgres with `LISTEN`/`NOTIFY` (adds a container). The design's [Alternatives considered](../design/sqlite-queue.md#alternatives-considered) has the full list.
