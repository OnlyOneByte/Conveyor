import type { Database } from "bun:sqlite";
import type { FilamentUse, Job, JobState, JobTarget, StageTiming } from "../job.js";
import type { NoteText } from "../job-notes.js";
import type { Stage } from "../plugins.js";
import { type JobRow, rowToJob } from "./job-row.js";
import { dbGetPrinter } from "./printers.js";
import { dbGetProfile } from "./profiles.js";

export function dbResolveJobTarget(
  db: Database,
  printerId: string,
  profileId: string,
): JobTarget | null {
  const printer = dbGetPrinter(db, printerId);
  const profile = dbGetProfile(db, profileId);
  if (!printer || !profile) return null;
  return {
    printerId: printer.id,
    transportId: printer.transportId,
    profileId: profile.id,
    profileName: profile.name,
    profilePath: profile.path,
    slicerId: profile.slicerId,
    gcodeFlavor: profile.gcodeFlavor,
    allowedGenerators: printer.allowedGenerators,
  };
}

export interface SettledJob {
  id: string;
  generatorId: string;
  params?: unknown;
  printerId: string;
  profileId: string;
  state: JobState;
  stage?: Stage | null;
  error?: { stage: Stage; reason: string };
  modelPath?: string;
  gcodePath?: string;
  timings?: StageTiming[];
  filament?: FilamentUse;
  notes?: NoteText;
}

export function dbRecordJob(db: Database, job: SettledJob): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO jobs (id, generator_id, params_json, printer_id, profile_id, state, stage, error_json, model_path, gcode_path, timings_json, filament_json, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       state=excluded.state, stage=excluded.stage, error_json=excluded.error_json,
       model_path=excluded.model_path, gcode_path=excluded.gcode_path,
       timings_json=excluded.timings_json, filament_json=excluded.filament_json, notes=excluded.notes, updated_at=excluded.updated_at`,
  ).run(
    job.id,
    job.generatorId,
    job.params !== undefined ? JSON.stringify(job.params) : null,
    job.printerId,
    job.profileId,
    job.state,
    job.stage ?? null,
    job.error ? JSON.stringify(job.error) : null,
    job.modelPath ?? null,
    job.gcodePath ?? null,
    job.timings?.length ? JSON.stringify(job.timings) : null,
    job.filament ? JSON.stringify(job.filament) : null,
    job.notes ?? null,
    now,
    now,
  );
}

export const HISTORY_STATES = ["done", "failed", "canceled"] as const;
export type HistoryState = (typeof HISTORY_STATES)[number];
export type HistoryCounts = Record<HistoryState, number>;

export interface HistoryFilter {
  printerId?: string;
  since?: number;
  until?: number;
}

export interface HistoryPage extends HistoryFilter {
  limit: number;
  state?: HistoryState;
  before?: { updatedAt: number; id: string };
}

type SqlParam = string | number;

function historyWhere(filter: Partial<HistoryPage>): { sql: string; params: SqlParam[] } {
  const terms = ["state IN ('done', 'failed', 'canceled')"];
  const params: SqlParam[] = [];
  const add = (term: string, ...values: SqlParam[]) => {
    terms.push(term);
    params.push(...values);
  };
  if (filter.state) add("state = ?", filter.state);
  if (filter.printerId !== undefined) add("printer_id = ?", filter.printerId);
  if (filter.since !== undefined) add("updated_at >= ?", filter.since);
  if (filter.until !== undefined) add("updated_at < ?", filter.until);
  if (filter.before) add("(updated_at, id) < (?, ?)", filter.before.updatedAt, filter.before.id);
  return { sql: terms.join(" AND "), params };
}

export function dbListJobs(db: Database, page: HistoryPage = { limit: 50 }): Job[] {
  const { sql, params } = historyWhere(page);
  return db
    .query<JobRow, SqlParam[]>(
      `SELECT * FROM jobs INDEXED BY idx_jobs_history WHERE ${sql} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(...params, page.limit)
    .flatMap((row) => rowToJob(row) ?? []);
}

export function dbCountJobs(db: Database, filter: HistoryFilter = {}): HistoryCounts {
  const { sql, params } = historyWhere(filter);
  const counts: HistoryCounts = { done: 0, failed: 0, canceled: 0 };
  const windowed = filter.since !== undefined || filter.until !== undefined;
  const index = windowed ? "INDEXED BY idx_jobs_history" : "";
  const rows = db
    .query<{ state: HistoryState; n: number }, SqlParam[]>(
      `SELECT state, COUNT(*) AS n FROM jobs ${index} WHERE ${sql} GROUP BY state`,
    )
    .all(...params);
  for (const row of rows) counts[row.state] = row.n;
  return counts;
}

export function dbGetJob(db: Database, id: string): Job | null {
  const row = db.query<JobRow, [string]>("SELECT * FROM jobs WHERE id = ?").get(id);
  return (row && rowToJob(row)) ?? null;
}

export type DismissResult =
  | { kind: "dismissed"; dismissedAt: number }
  | { kind: "not-failed"; state: JobState }
  | { kind: "unknown" };

export function dbDismissJob(db: Database, id: string, at: number): DismissResult {
  const row = db
    .query<{ state: JobState; dismissed_at: number | null }, [number, string]>(
      `UPDATE jobs SET dismissed_at = COALESCE(dismissed_at, ?)
        WHERE id = ? AND state = 'failed' RETURNING state, dismissed_at`,
    )
    .get(at, id);
  if (row && row.dismissed_at !== null) return { kind: "dismissed", dismissedAt: row.dismissed_at };
  const found = db
    .query<{ state: JobState }, [string]>("SELECT state FROM jobs WHERE id = ?")
    .get(id);
  return found ? { kind: "not-failed", state: found.state } : { kind: "unknown" };
}

export function dbRetryProblem(db: Database, id: string): string | null {
  const row = db
    .query<{ state: JobState }, [string]>("SELECT state FROM jobs WHERE id = ?")
    .get(id);
  if (!row) return `retryOf: unknown job ${id}`;
  return row.state === "failed" ? null : `retryOf: job ${id} is ${row.state}, not failed`;
}

export function dbClaimRetry(db: Database, id: string, by: string): boolean {
  return (
    db
      .query(
        "UPDATE jobs SET retried_by = ? WHERE id = ? AND state = 'failed' AND retried_by IS NULL",
      )
      .run(by, id).changes === 1
  );
}

export function dbRetriedBy(db: Database, id: string): string | null {
  const row = db
    .query<{ retried_by: string | null }, [string]>("SELECT retried_by FROM jobs WHERE id = ?")
    .get(id);
  return row?.retried_by ?? null;
}

export function dbReleaseRetry(db: Database, id: string, by: string): void {
  db.query("UPDATE jobs SET retried_by = NULL WHERE id = ? AND retried_by = ?").run(id, by);
}

export function dbListNeedsYou(db: Database, limit = 50): Job[] {
  return db
    .query<JobRow, [number]>(
      `SELECT * FROM jobs INDEXED BY idx_jobs_needs_you WHERE state = 'failed' AND dismissed_at IS NULL
        AND retried_by IS NULL ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(limit)
    .flatMap((row) => rowToJob(row) ?? []);
}
