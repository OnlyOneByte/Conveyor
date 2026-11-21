import type { Database } from "bun:sqlite";
import { epochMs } from "../db/epoch-ms.js";
import type { JobRequest, JobState } from "../job.js";
import { appendEvent } from "./event-log.js";

export const IN_FLIGHT_STATES = ["generating", "slicing", "transferring", "printing"] as const;
export const IN_FLIGHT_SQL = IN_FLIGHT_STATES.map((state) => `'${state}'`).join(", ");

export interface QueueTiming {
  leaseMs: number;
  backoffBaseMs: number;
  now: () => number;
}

export const DEFAULT_TIMING: QueueTiming = { leaseMs: 30_000, backoffBaseMs: 5_000, now: epochMs };

export interface Lease {
  jobId: string;
  owner: string;
  token: number;
  until: number;
}

export interface ClaimedJob {
  lease: Lease;
  request: JobRequest;
  state: JobState;
  attempts: number;
  resumed: boolean;
}

export const CLEAR_PROGRESS = "stage = NULL, progress = NULL, message = NULL";

export type ReleaseOutcome = "requeued" | "canceled" | "orphaned" | "submitting" | "lost";

export function inImmediate<T>(db: Database, now: () => number, step: (at: number) => T): T {
  return db.transaction(() => step(now())).immediate();
}

export const FENCE =
  "id = $id AND lease_owner = $owner AND lease_token = $token AND lease_until >= $now";

export function fenceOf(lease: Lease, at: number) {
  return { $id: lease.jobId, $owner: lease.owner, $token: lease.token, $now: at };
}

export function enqueueJob(
  db: Database,
  job: { id: string; request: JobRequest },
  timing: QueueTiming = DEFAULT_TIMING,
): void {
  const { generator, printerId, profileId } = job.request;
  const params = generator.params === undefined ? null : JSON.stringify(generator.params);
  inImmediate(db, timing.now, (at) => {
    db.query(
      `INSERT INTO jobs (id, generator_id, params_json, printer_id, profile_id, state, run_after, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    ).run(job.id, generator.id, params, printerId, profileId, at, at, at);
    appendEvent(db, { jobId: job.id, state: "queued", at });
  });
}

interface ClaimRow {
  id: string;
  generator_id: string;
  params_json: string | null;
  printer_id: string | null;
  profile_id: string | null;
  state: JobState;
  attempts: number;
  lease_token: number;
  submitted_at: number | null;
}

const CLAIM_SQL = `UPDATE jobs SET
    state = CASE WHEN submitted_at IS NULL THEN 'generating' ELSE state END,
    attempts = CASE WHEN submitted_at IS NULL THEN attempts + 1 ELSE attempts END,
    lease_owner = $owner, lease_token = lease_token + 1, lease_until = $until, updated_at = $now
  WHERE id = (
    SELECT j.id FROM jobs j
     WHERE ((j.state = 'queued' AND j.run_after <= $now AND j.cancel_requested_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM jobs p WHERE p.printer_id = j.printer_id AND p.id <> j.id
                               AND p.state IN ('generating', 'slicing'))
             AND NOT EXISTS (SELECT 1 FROM printers h WHERE h.id = j.printer_id
                               AND h.hold_job_id IS NOT NULL))
         OR (j.state IN ('transferring', 'printing') AND j.lease_owner IS NULL
             AND j.submitted_at IS NOT NULL))
     ORDER BY j.submitted_at IS NULL, j.created_at, j.rowid
     LIMIT 1)
  RETURNING id, generator_id, params_json, printer_id, profile_id, state, attempts, lease_token, submitted_at`;

export function claimJob(
  db: Database,
  owner: string,
  timing: QueueTiming = DEFAULT_TIMING,
): ClaimedJob | null {
  return inImmediate(db, timing.now, (at) => {
    const until = at + timing.leaseMs;
    const row = db
      .query<ClaimRow, Record<string, string | number>>(CLAIM_SQL)
      .get({ $owner: owner, $until: until, $now: at });
    if (!row) return null;
    if (row.submitted_at === null) appendEvent(db, { jobId: row.id, state: "generating", at });
    const params: unknown = row.params_json === null ? undefined : JSON.parse(row.params_json);
    return {
      lease: { jobId: row.id, owner, token: row.lease_token, until },
      request: {
        generator: { id: row.generator_id, params },
        printerId: row.printer_id ?? "",
        profileId: row.profile_id ?? "",
      },
      state: row.state,
      attempts: row.attempts,
      resumed: row.submitted_at !== null,
    };
  });
}

export function renewLease(
  db: Database,
  lease: Lease,
  timing: QueueTiming = DEFAULT_TIMING,
): Lease | null {
  return inImmediate(db, timing.now, (at) => {
    const until = at + timing.leaseMs;
    const { changes } = db
      .query(
        `UPDATE jobs SET lease_until = $until, updated_at = $now
          WHERE ${FENCE} AND state IN (${IN_FLIGHT_SQL})`,
      )
      .run({ ...fenceOf(lease, at), $until: until });
    return changes === 1 ? { ...lease, until } : null;
  });
}

interface SubmitMarks {
  submit_started_at: number | null;
  submitted_at: number | null;
  cancel_requested_at: number | null;
}

export function releaseLease(
  db: Database,
  lease: Lease,
  timing: QueueTiming = DEFAULT_TIMING,
): ReleaseOutcome {
  return inImmediate(db, timing.now, (at) => {
    const fence = fenceOf(lease, at);
    const marks = db
      .query<SubmitMarks, Record<string, string | number>>(
        `SELECT submit_started_at, submitted_at, cancel_requested_at FROM jobs
          WHERE ${FENCE} AND state IN (${IN_FLIGHT_SQL})`,
      )
      .get(fence);
    if (!marks) return "lost";
    if (marks.submitted_at === null && marks.submit_started_at !== null) return "submitting";
    const unsent = marks.submitted_at === null;
    const cancel = unsent && marks.cancel_requested_at !== null;
    const settle = cancel
      ? ", state = 'canceled'"
      : unsent
        ? `, state = 'queued', attempts = attempts - 1, run_after = $now, ${CLEAR_PROGRESS}`
        : "";
    db.query(
      `UPDATE jobs SET lease_owner = NULL, lease_until = NULL, lease_token = lease_token + 1,
         updated_at = $now${settle}
        WHERE ${FENCE}`,
    ).run(fence);
    if (unsent) appendEvent(db, { jobId: lease.jobId, state: cancel ? "canceled" : "queued", at });
    return cancel ? "canceled" : unsent ? "requeued" : "orphaned";
  });
}
