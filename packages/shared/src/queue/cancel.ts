import type { Database } from "bun:sqlite";
import { isTerminal, JOB_STATES, type JobState } from "../job.js";
import { appendEvent } from "./event-log.js";
import { holdPrinter } from "./hold.js";
import {
  CLEAR_PROGRESS,
  DEFAULT_TIMING,
  FENCE,
  fenceOf,
  inImmediate,
  type Lease,
  type QueueTiming,
  RELEASED_LEASE,
} from "./lease.js";

export type CancelOutcome =
  | { kind: "settled"; state: JobState }
  | { kind: "unknown" }
  | { kind: "canceled" }
  | { kind: "canceling" };

export const STOP_UNCONFIRMED_REASON =
  "cancel requested but the printer did not confirm the stop; check the printer before releasing it";

function jobStateOf(raw: string): JobState {
  const state = JOB_STATES.find((known) => known === raw);
  if (!state) throw new Error(`job has an unknown state ${raw}`);
  return state;
}

export function requestCancel(
  db: Database,
  jobId: string,
  timing: QueueTiming = DEFAULT_TIMING,
): CancelOutcome {
  return inImmediate(db, timing.now, (at) => {
    const row = db
      .query<{ state: string }, [string]>("SELECT state FROM jobs WHERE id = ?")
      .get(jobId);
    if (!row) return { kind: "unknown" };
    const state = jobStateOf(row.state);
    if (isTerminal(state)) return { kind: "settled", state };
    if (state === "queued") {
      db.query(
        `UPDATE jobs SET state = 'canceled', cancel_requested_at = ?, ${CLEAR_PROGRESS}, updated_at = ?
          WHERE id = ?`,
      ).run(at, at, jobId);
      appendEvent(db, { jobId, state: "canceled", at });
      return { kind: "canceled" };
    }
    db.query(
      "UPDATE jobs SET cancel_requested_at = COALESCE(cancel_requested_at, ?) WHERE id = ?",
    ).run(at, jobId);
    return { kind: "canceling" };
  });
}

export function isCancelRequested(db: Database, jobId: string): boolean {
  const row = db
    .query<{ requested: number }, [string]>(
      "SELECT cancel_requested_at IS NOT NULL AS requested FROM jobs WHERE id = ?",
    )
    .get(jobId);
  return row?.requested === 1;
}

interface SettleRow {
  printer_id: string | null;
  submit_started_at: number | null;
}

export function settleCancel(
  db: Database,
  lease: Lease,
  stopConfirmed: boolean,
  timing: QueueTiming = DEFAULT_TIMING,
): JobState | null {
  return inImmediate(db, timing.now, (at) => {
    const fence = fenceOf(lease, at);
    const row = db
      .query<SettleRow, Record<string, string | number>>(
        `SELECT printer_id, submit_started_at FROM jobs
          WHERE ${FENCE} AND cancel_requested_at IS NOT NULL AND state NOT IN ('done', 'failed', 'canceled')`,
      )
      .get(fence);
    if (!row) return null;
    if (stopConfirmed || row.submit_started_at === null) {
      db.query(
        `UPDATE jobs SET state = 'canceled', ${RELEASED_LEASE}, updated_at = $now WHERE ${FENCE}`,
      ).run(fence);
      appendEvent(db, { jobId: lease.jobId, state: "canceled", at });
      return "canceled";
    }
    const error = { stage: "transport", reason: STOP_UNCONFIRMED_REASON } as const;
    db.query(
      `UPDATE jobs SET state = 'failed', error_json = $error, ${RELEASED_LEASE}, updated_at = $now WHERE ${FENCE}`,
    ).run({ ...fence, $error: JSON.stringify(error) });
    appendEvent(db, { jobId: lease.jobId, state: "failed", stage: error.stage, error, at });
    holdPrinter(db, {
      printerId: row.printer_id,
      jobId: lease.jobId,
      reason: STOP_UNCONFIRMED_REASON,
      at,
    });
    return "failed";
  });
}
