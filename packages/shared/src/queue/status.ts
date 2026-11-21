import type { Database } from "bun:sqlite";
import type { JobStatusEvent } from "../events.js";
import { exhaustive } from "../exhaustive.js";
import { isTerminal, type JobState, TERMINAL_STATES } from "../job.js";
import { parseStatusEvent } from "../status.js";
import { appendEvent } from "./event-log.js";
import { holdPrinter } from "./hold.js";
import {
  DEFAULT_TIMING,
  FENCE,
  fenceOf,
  inImmediate,
  type Lease,
  type QueueTiming,
} from "./lease.js";

export const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const UPLOAD_SETTLE_REASON =
  "the job settled during upload, before the printer confirmed it; check the printer before releasing it";
const TERMINAL_SQL = TERMINAL_STATES.map((state) => `'${state}'`).join(", ");
const SETTLE = ", lease_owner = NULL, lease_until = NULL, lease_token = lease_token + 1";

function submitWindowRule(state: JobState): string {
  switch (state) {
    case "transferring":
      return "submit_started_at IS NOT NULL AND submitted_at IS NULL";
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
    const fence = fenceOf(lease, at);
    const window = isTerminal(update.state)
      ? db
          .query<{ printer_id: string | null }, Record<string, string | number>>(
            `SELECT printer_id FROM jobs
              WHERE ${FENCE} AND submit_started_at IS NOT NULL AND submitted_at IS NULL`,
          )
          .get(fence)
      : null;
    const written: StatusUpdate = window
      ? {
          ...update,
          state: "failed",
          error: update.error ?? { stage: "transport", reason: UPLOAD_SETTLE_REASON },
        }
      : update;
    const { changes } = db
      .query(
        `UPDATE jobs SET state = $state, stage = $stage, progress = $progress, message = $message,
           error_json = $error, timings_json = $timings, updated_at = $now${isTerminal(written.state) ? SETTLE : ""}
          WHERE ${FENCE} AND state NOT IN (${TERMINAL_SQL}) AND ${submitWindowRule(written.state)}`,
      )
      .run({
        ...fence,
        $state: written.state,
        $stage: written.stage ?? null,
        $progress: written.progress ?? null,
        $message: written.message ?? null,
        $error: written.error ? JSON.stringify(written.error) : null,
        $timings: written.timings?.length ? JSON.stringify(written.timings) : null,
      });
    if (changes !== 1) return false;
    appendEvent(db, { ...written, jobId: lease.jobId, at });
    if (window) {
      holdPrinter(db, {
        printerId: window.printer_id,
        jobId: lease.jobId,
        reason: UPLOAD_SETTLE_REASON,
        at,
      });
    }
    return true;
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
