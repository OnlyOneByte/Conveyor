import type { Database } from "bun:sqlite";
import type { PrintHandle } from "../plugins.js";
import { appendEvent } from "./event-log.js";
import {
  DEFAULT_TIMING,
  FENCE,
  fenceOf,
  inImmediate,
  type Lease,
  type QueueTiming,
} from "./lease.js";

export type SlotOutcome = "taken" | "busy" | "canceled" | "refused" | "lost";

export function withFullSync<T>(db: Database, step: () => T): T {
  db.exec("PRAGMA synchronous = FULL;");
  try {
    return step();
  } finally {
    db.exec("PRAGMA synchronous = NORMAL;");
  }
}

interface SlotRow {
  state: string;
  submit_started_at: number | null;
  cancel_requested_at: number | null;
}

const TAKE_SLOT = `UPDATE jobs SET state = 'transferring', submit_started_at = $now, updated_at = $now
  WHERE ${FENCE} AND state = 'slicing' AND submit_started_at IS NULL AND cancel_requested_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jobs o WHERE o.printer_id = jobs.printer_id AND o.id <> jobs.id
                      AND o.state IN ('transferring', 'printing'))
    AND NOT EXISTS (SELECT 1 FROM printers p WHERE p.id = jobs.printer_id AND p.hold_job_id IS NOT NULL)`;

export function takePrinterSlot(
  db: Database,
  lease: Lease,
  timing: QueueTiming = DEFAULT_TIMING,
): SlotOutcome {
  return withFullSync(db, () =>
    inImmediate(db, timing.now, (at) => {
      const fence = fenceOf(lease, at);
      if (db.query(TAKE_SLOT).run(fence).changes === 1) {
        appendEvent(db, { jobId: lease.jobId, state: "transferring", at });
        return "taken";
      }
      const row = db
        .query<SlotRow, Record<string, string | number>>(
          `SELECT state, submit_started_at, cancel_requested_at FROM jobs WHERE ${FENCE}`,
        )
        .get(fence);
      if (!row) return "lost";
      if (row.state !== "slicing" || row.submit_started_at !== null) return "refused";
      return row.cancel_requested_at === null ? "busy" : "canceled";
    }),
  );
}

export function markNotSubmitted(
  db: Database,
  lease: Lease,
  timing: QueueTiming = DEFAULT_TIMING,
): boolean {
  return inImmediate(db, timing.now, (at) => {
    const { changes } = db
      .query(
        `UPDATE jobs SET submit_started_at = NULL, updated_at = $now
          WHERE ${FENCE} AND state = 'transferring'
            AND submit_started_at IS NOT NULL AND submitted_at IS NULL`,
      )
      .run(fenceOf(lease, at));
    return changes === 1;
  });
}

export function markSubmitted(
  db: Database,
  lease: Lease,
  handle: PrintHandle,
  timing: QueueTiming = DEFAULT_TIMING,
): boolean {
  return withFullSync(db, () =>
    inImmediate(db, timing.now, (at) => {
      const { changes } = db
        .query(
          `UPDATE jobs SET submitted_at = $now, print_handle_json = $handle, updated_at = $now
            WHERE ${FENCE} AND state = 'transferring'
              AND submit_started_at IS NOT NULL AND submitted_at IS NULL`,
        )
        .run({ ...fenceOf(lease, at), $handle: JSON.stringify(handle) });
      return changes === 1;
    }),
  );
}
