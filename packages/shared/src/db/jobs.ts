import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { FilamentUse, Job, JobState, JobTarget, StageTiming } from "../job.js";
import type { Stage } from "../plugins.js";
import { dbListPrinters } from "./printers.js";
import { dbListProfiles } from "./profiles.js";

export function dbResolveJobTarget(
  db: Database,
  printerId: string,
  profileId: string,
): JobTarget | null {
  const printer = dbListPrinters(db).find((p) => p.id === printerId);
  const profile = dbListProfiles(db).find((p) => p.id === profileId);
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

interface JobRow {
  id: string;
  generator_id: string;
  params_json: string | null;
  printer_id: string | null;
  profile_id: string | null;
  state: string;
  stage: string | null;
  error_json: string | null;
  model_path: string | null;
  gcode_path: string | null;
  timings_json: string | null;
  filament_json: string | null;
  notes: string | null;
  dismissed_at: number | null;
  created_at: number;
  updated_at: number;
}

const filamentSchema = z.object({
  grams: z.number().nonnegative().optional(),
  metres: z.number().nonnegative().optional(),
});

function filamentOf(json: string | null): FilamentUse | undefined {
  if (!json) return undefined;
  try {
    return filamentSchema.parse(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function rowToJob(r: JobRow): Job {
  return {
    id: r.id,
    request: {
      generator: {
        id: r.generator_id,
        params: r.params_json ? JSON.parse(r.params_json) : undefined,
      },
      printerId: r.printer_id ?? "",
      profileId: r.profile_id ?? "",
    },
    state: r.state as JobState,
    stage: (r.stage as Stage) ?? null,
    error: r.error_json ? JSON.parse(r.error_json) : undefined,
    artifacts: { model: r.model_path ?? undefined, gcode: r.gcode_path ?? undefined },
    timings: r.timings_json ? (JSON.parse(r.timings_json) as StageTiming[]) : undefined,
    filament: filamentOf(r.filament_json),
    notes: r.notes ?? undefined,
    dismissedAt: r.dismissed_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
  notes?: string;
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
    .map(rowToJob);
}

export function dbCountJobs(db: Database, filter: HistoryFilter = {}): HistoryCounts {
  const { sql, params } = historyWhere(filter);
  const counts: HistoryCounts = { done: 0, failed: 0, canceled: 0 };
  const rows = db
    .query<{ state: HistoryState; n: number }, SqlParam[]>(
      `SELECT state, COUNT(*) AS n FROM jobs WHERE ${sql} GROUP BY state`,
    )
    .all(...params);
  for (const row of rows) counts[row.state] = row.n;
  return counts;
}

export function dbGetJob(db: Database, id: string): Job | null {
  const row = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
  return row ? rowToJob(row) : null;
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

export function dbListNeedsYou(db: Database, limit = 50): Job[] {
  return db
    .query<JobRow, [number]>(
      `SELECT * FROM jobs WHERE state = 'failed' AND dismissed_at IS NULL
        ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(limit)
    .map(rowToJob);
}
