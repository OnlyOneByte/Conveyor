import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { Stage } from "../plugins.js";

export const TYPICAL_SAMPLE = 20;
export const MIN_TYPICAL_SAMPLES = 3;

export type StageDurations = Partial<Record<Stage, number>>;

const stageSchema = z.enum(["generator", "slicer", "transport"]);
const timingsSchema = z.array(
  z.object({ stage: stageSchema, durationMs: z.number().nonnegative() }),
);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const middle = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? middle : Math.round(((sorted[mid - 1] ?? 0) + middle) / 2);
}

function parsedOrNull(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function dbTypicalStageMs(
  db: Database,
  job: { generatorId: string; printerId: string },
  sample = TYPICAL_SAMPLE,
): StageDurations {
  const rows = db
    .query<{ timings_json: string }, [string, string, number]>(
      `SELECT timings_json FROM jobs
        WHERE state = 'done' AND generator_id = ? AND printer_id = ? AND timings_json IS NOT NULL
        ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(job.generatorId, job.printerId, sample);
  const seen = new Map<Stage, number[]>();
  for (const row of rows) {
    const timings = timingsSchema.safeParse(parsedOrNull(row.timings_json));
    for (const { stage, durationMs } of timings.data ?? [])
      seen.set(stage, [...(seen.get(stage) ?? []), durationMs]);
  }
  const typical: StageDurations = {};
  for (const [stage, values] of seen) {
    if (values.length >= MIN_TYPICAL_SAMPLES) typical[stage] = median(values);
  }
  return typical;
}
