import type { Database } from "bun:sqlite";
import type { Stage } from "../plugins.js";
import { readJson } from "./json.js";
import { stageTimingsSchema } from "./typical.js";

export const METRICS_TIMING_SAMPLE = 500;

export interface StageDuration {
  stage: Stage;
  durationMs: number;
}

export function dbFailuresByStage(db: Database): { stage: string | null; n: number }[] {
  return db
    .query<{ stage: string | null; n: number }, []>(
      "SELECT stage, COUNT(*) AS n FROM jobs WHERE state = 'failed' GROUP BY stage ORDER BY stage",
    )
    .all();
}

export function dbLiveJobCounts(db: Database): { state: string; n: number }[] {
  return db
    .query<{ state: string; n: number }, []>(
      `SELECT state, COUNT(*) AS n FROM jobs
        WHERE state NOT IN ('done', 'failed', 'canceled') GROUP BY state ORDER BY state`,
    )
    .all();
}

export function dbRecentStageDurations(
  db: Database,
  sample = METRICS_TIMING_SAMPLE,
): StageDuration[] {
  const rows = db
    .query<{ timings_json: string }, [number]>(
      `SELECT timings_json FROM jobs INDEXED BY idx_jobs_history
        WHERE state IN ('done', 'failed', 'canceled') AND state = 'done' AND timings_json IS NOT NULL
        ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(sample);
  return rows.flatMap((row) => {
    const read = readJson(row.timings_json);
    return stageTimingsSchema.safeParse(read.ok ? read.value : null).data ?? [];
  });
}
