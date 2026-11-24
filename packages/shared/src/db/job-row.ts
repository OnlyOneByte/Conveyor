import { z } from "zod";
import type { FilamentUse, Job, JobState, StageTiming, UnreadableColumn } from "../job.js";
import type { Stage } from "../plugins.js";

export interface JobRow {
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
  retried_by: string | null;
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

const stageSchema = z.enum(["generator", "slicer", "transport"]);

const paramsSchema = z.record(z.string(), z.unknown());
const errorSchema = z.object({ stage: stageSchema, reason: z.string() });
const timingsSchema = z.array(
  z.object({ stage: stageSchema, enteredAt: z.number(), durationMs: z.number().optional() }),
);

const warnedUnreadable = new Set<string>();

function parseJson(json: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false };
  }
}

function readColumn<T>(
  r: JobRow,
  column: UnreadableColumn,
  json: string | null,
  schema: z.ZodType<T>,
  unreadable: UnreadableColumn[],
): T | undefined {
  if (!json) return undefined;
  const parsed = parseJson(json);
  const checked = parsed.ok ? schema.safeParse(parsed.value) : undefined;
  if (checked?.success) return checked.data;
  unreadable.push(column);
  const key = `${r.id}:${column}`;
  if (!warnedUnreadable.has(key)) {
    warnedUnreadable.add(key);
    console.warn(`[jobs] job ${r.id} has an unreadable ${column} column; listing it without it`);
  }
  return undefined;
}

export function rowToJob(r: JobRow): Job {
  const unreadable: UnreadableColumn[] = [];
  const params = readColumn(r, "params", r.params_json, paramsSchema, unreadable);
  const error = readColumn(r, "error", r.error_json, errorSchema, unreadable);
  const timings: StageTiming[] | undefined = readColumn(
    r,
    "timings",
    r.timings_json,
    timingsSchema,
    unreadable,
  );
  return {
    id: r.id,
    request: {
      generator: { id: r.generator_id, params },
      printerId: r.printer_id ?? "",
      profileId: r.profile_id ?? "",
    },
    state: r.state as JobState,
    stage: (r.stage as Stage) ?? null,
    error,
    artifacts: { model: r.model_path ?? undefined, gcode: r.gcode_path ?? undefined },
    timings,
    filament: filamentOf(r.filament_json),
    notes: r.notes ?? undefined,
    dismissedAt: r.dismissed_at ?? undefined,
    ...(unreadable.length ? { unreadable } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
