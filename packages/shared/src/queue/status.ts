import type { Database } from "bun:sqlite";
import type { JobStatusEvent } from "../events.js";
import { exhaustive } from "../exhaustive.js";
import { isTerminal, type JobState, TERMINAL_STATES } from "../job.js";
import { parseStatusEvent } from "../status.js";
import { appendEvent } from "./event-log.js";
import { DEFAULT_TIMING, inImmediate, type Lease, type QueueTiming } from "./lease.js";

export const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TERMINAL_SQL = TERMINAL_STATES.map((state) => `'${state}'`).join(", ");
const SETTLE = ", lease_owner = NULL, lease_until = NULL, lease_token = lease_token + 1";

function submitWindowRule(state: JobState): string {
  switch (state) {
    case "transferring":
      return "submit_started_at IS NOT NULL";
    case "printing":
      return "submitted_at IS NOT NULL";
    case "queued":
    case "generating":
    case "slicing":
      return "submit_started_at IS NULL";
    case "done":
    case "failed":
    case "canceled":
      return "1";
    default:
      return exhaustive(state);
  }
}

export type StatusUpdate = Omit<JobStatusEvent, "jobId" | "at">;

export interface JobSnapshot {
  snapshot: JobStatusEvent;
  cursor: number;
}

export interface TailedEvent {
  seq: number;
  event: JobStatusEvent;
}

export function writeStatus(
  db: Database,
  lease: Lease,
  update: StatusUpdate,
  timing: QueueTiming = DEFAULT_TIMING,
): boolean {
  return inImmediate(db, timing.now, (at) => {
    const { changes } = db
      .query(
        `UPDATE jobs SET state = $state, stage = $stage, progress = $progress, message = $message,
           error_json = $error, timings_json = $timings, updated_at = $now${isTerminal(update.state) ? SETTLE : ""}
          WHERE id = $id AND lease_owner = $owner AND lease_token = $token AND lease_until >= $now
            AND state NOT IN (${TERMINAL_SQL}) AND ${submitWindowRule(update.state)}`,
      )
      .run({
        $id: lease.jobId,
        $owner: lease.owner,
        $token: lease.token,
        $now: at,
        $state: update.state,
        $stage: update.stage ?? null,
        $progress: update.progress ?? null,
        $message: update.message ?? null,
        $error: update.error ? JSON.stringify(update.error) : null,
        $timings: update.timings?.length ? JSON.stringify(update.timings) : null,
      });
    if (changes === 1) appendEvent(db, { ...update, jobId: lease.jobId, at });
    return changes === 1;
  });
}

interface SnapshotRow {
  state: string;
  stage: string | null;
  progress: number | null;
  message: string | null;
  error_json: string | null;
  timings_json: string | null;
  updated_at: number;
  cursor: number;
}

function toEvent(raw: string, what: string): JobStatusEvent {
  const event = parseStatusEvent(raw);
  if (!event) throw new Error(`${what} is not a valid job status event`);
  return event;
}

function parsedOrAbsent(json: string | null): unknown {
  return json === null ? undefined : JSON.parse(json);
}

export function readSnapshot(db: Database, jobId: string): JobSnapshot | null {
  const row = db
    .query<SnapshotRow, [string, string]>(
      `SELECT state, stage, progress, message, error_json, timings_json, updated_at,
              (SELECT COALESCE(MAX(seq), 0) FROM job_events WHERE job_id = ?) AS cursor
         FROM jobs WHERE id = ?`,
    )
    .get(jobId, jobId);
  if (!row) return null;
  const raw = JSON.stringify({
    jobId,
    state: row.state,
    stage: row.stage,
    at: row.updated_at,
    progress: row.progress ?? undefined,
    message: row.message ?? undefined,
    error: parsedOrAbsent(row.error_json),
    timings: parsedOrAbsent(row.timings_json),
  });
  return { snapshot: toEvent(raw, `job ${jobId}`), cursor: row.cursor };
}

export function tailEvents(
  db: Database,
  jobId: string,
  afterSeq: number,
  limit = 100,
): TailedEvent[] {
  return db
    .query<{ seq: number; event: string }, [string, number, number]>(
      "SELECT seq, event FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    )
    .all(jobId, afterSeq, limit)
    .map(({ seq, event }) => ({ seq, event: toEvent(event, `job event ${seq}`) }));
}

export function pruneEvents(
  db: Database,
  timing: QueueTiming = DEFAULT_TIMING,
  retentionMs = EVENT_RETENTION_MS,
): number {
  return inImmediate(db, timing.now, (at) => {
    const { changes } = db
      .query(
        `DELETE FROM job_events WHERE job_id IN (
           SELECT id FROM jobs WHERE state IN (${TERMINAL_SQL}) AND updated_at < ?)`,
      )
      .run(at - retentionMs);
    return changes;
  });
}
