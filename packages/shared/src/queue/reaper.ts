import type { Database } from "bun:sqlite";
import { exhaustive } from "../exhaustive.js";
import type { Stage } from "../plugins.js";
import {
  DEFAULT_TIMING,
  IN_FLIGHT_SQL,
  type IN_FLIGHT_STATES,
  inImmediate,
  type QueueTiming,
} from "./lease.js";

export type ReapOutcome = "requeued" | "failed" | "unknown" | "orphaned";

export interface ReapedJob {
  jobId: string;
  outcome: ReapOutcome;
}

interface ReapRow {
  id: string;
  state: (typeof IN_FLIGHT_STATES)[number];
  attempts: number;
  max_attempts: number;
  submit_started_at: number | null;
  submitted_at: number | null;
}

const UNKNOWN_REASON =
  "worker stopped while sending the job to the printer; check the printer before releasing it";

function stageOf(state: ReapRow["state"]): Stage {
  switch (state) {
    case "generating":
      return "generator";
    case "slicing":
      return "slicer";
    case "transferring":
    case "printing":
      return "transport";
    default:
      return exhaustive(state);
  }
}

function outcomeOf(row: ReapRow): ReapOutcome {
  if (row.submitted_at !== null) return "orphaned";
  if (row.submit_started_at !== null) return "unknown";
  return row.attempts < row.max_attempts ? "requeued" : "failed";
}

function reasonOf(row: ReapRow, outcome: "failed" | "unknown"): string {
  return outcome === "unknown"
    ? UNKNOWN_REASON
    : `worker lost the job ${row.attempts} times before it reached the printer`;
}

const TAKE_OVER = "lease_owner = NULL, lease_until = NULL, lease_token = lease_token + 1";

export function reapExpired(db: Database, timing: QueueTiming = DEFAULT_TIMING): ReapedJob[] {
  return inImmediate(db, timing.now, (at) => {
    const rows = db
      .query<ReapRow, Record<string, number>>(
        `SELECT id, state, attempts, max_attempts, submit_started_at, submitted_at FROM jobs
          WHERE state IN (${IN_FLIGHT_SQL})
            AND (lease_until < $now OR lease_until > $now + $leaseMs
                 OR (lease_owner IS NULL AND submitted_at IS NULL))`,
      )
      .all({ $now: at, $leaseMs: timing.leaseMs });
    return rows.map((row) => {
      const outcome = outcomeOf(row);
      if (outcome === "orphaned") {
        db.query(`UPDATE jobs SET ${TAKE_OVER}, updated_at = ? WHERE id = ?`).run(at, row.id);
      } else if (outcome === "requeued") {
        const runAfter = at + timing.backoffBaseMs * 2 ** Math.max(row.attempts - 1, 0);
        db.query(
          `UPDATE jobs SET ${TAKE_OVER}, state = 'queued', run_after = ?, updated_at = ? WHERE id = ?`,
        ).run(runAfter, at, row.id);
      } else {
        const error = JSON.stringify({ stage: stageOf(row.state), reason: reasonOf(row, outcome) });
        db.query(
          `UPDATE jobs SET ${TAKE_OVER}, state = 'failed', error_json = ?, updated_at = ? WHERE id = ?`,
        ).run(error, at, row.id);
      }
      return { jobId: row.id, outcome };
    });
  });
}
