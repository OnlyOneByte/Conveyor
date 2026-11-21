import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { StageTiming } from "../job.js";
import type { PrintHandle } from "../plugins.js";
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
import { readSnapshot } from "./status.js";

export const RESUME_FAILED_REASON =
  "worker restarted mid-print and could not reconnect; check the printer before releasing it";

const handleSchema = z.object({
  transportId: z.string(),
  printerId: z.string(),
  ref: z.string(),
  address: z.string().optional(),
  deviceId: z.string().optional(),
});

const ON_PRINTER = "state IN ('transferring', 'printing') AND submitted_at IS NOT NULL";

export interface ResumeState {
  handle: PrintHandle;
  modelPath?: string;
  gcodePath?: string;
  timings?: StageTiming[];
}

interface ResumeRow {
  print_handle_json: string | null;
  model_path: string | null;
  gcode_path: string | null;
}

export function readResumeState(
  db: Database,
  lease: Lease,
  timing: QueueTiming = DEFAULT_TIMING,
): ResumeState | null {
  const row = db
    .query<ResumeRow, Record<string, string | number>>(
      `SELECT print_handle_json, model_path, gcode_path FROM jobs WHERE ${FENCE} AND ${ON_PRINTER}`,
    )
    .get(fenceOf(lease, timing.now()));
  if (!row?.print_handle_json) return null;
  const parsed = handleSchema.safeParse(JSON.parse(row.print_handle_json));
  if (!parsed.success) return null;
  return {
    handle: parsed.data,
    modelPath: row.model_path ?? undefined,
    gcodePath: row.gcode_path ?? undefined,
    timings: readSnapshot(db, lease.jobId)?.snapshot.timings,
  };
}

export function failResume(
  db: Database,
  lease: Lease,
  timing: QueueTiming = DEFAULT_TIMING,
): boolean {
  return inImmediate(db, timing.now, (at) => {
    const fence = fenceOf(lease, at);
    const row = db
      .query<{ printer_id: string | null }, Record<string, string | number>>(
        `SELECT printer_id FROM jobs WHERE ${FENCE} AND ${ON_PRINTER}`,
      )
      .get(fence);
    if (!row) return false;
    const error = { stage: "transport", reason: RESUME_FAILED_REASON } as const;
    db.query(
      `UPDATE jobs SET state = 'failed', stage = 'transport', error_json = $error, lease_owner = NULL,
         lease_until = NULL, lease_token = lease_token + 1, updated_at = $now WHERE ${FENCE}`,
    ).run({ ...fence, $error: JSON.stringify(error) });
    appendEvent(db, { jobId: lease.jobId, state: "failed", stage: "transport", error, at });
    holdPrinter(db, {
      printerId: row.printer_id,
      jobId: lease.jobId,
      reason: RESUME_FAILED_REASON,
      at,
    });
    return true;
  });
}
