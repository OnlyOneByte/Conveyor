import { z } from "zod";
import {
  type FilamentUse,
  JOB_STATES,
  type Job,
  type StageTiming,
  type UnreadableColumn,
} from "../job.js";
import type { Stage } from "../plugins.js";
import { readJson } from "./json.js";

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

const warned = new Set<string>();

function warnOnce(key: string, line: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(line);
}

function markUnreadable(r: JobRow, column: UnreadableColumn, unreadable: UnreadableColumn[]): void {
  unreadable.push(column);
  warnOnce(
    `${r.id}:${column}`,
    `[jobs] job ${r.id} has an unreadable ${column} column; listing it without it`,
  );
}

function readColumn<T>(
  r: JobRow,
  column: UnreadableColumn,
  json: string | null,
  schema: z.ZodType<T>,
  unreadable: UnreadableColumn[],
): T | undefined {
  if (!json) return undefined;
  const parsed = readJson(json);
  const checked = parsed.ok ? schema.safeParse(parsed.value) : undefined;
  if (checked?.success) return checked.data;
  markUnreadable(r, column, unreadable);
  return undefined;
}

function stageOf(r: JobRow, unreadable: UnreadableColumn[]): Stage | null {
  if (r.stage === null) return null;
  const parsed = stageSchema.safeParse(r.stage);
  if (parsed.success) return parsed.data;
  markUnreadable(r, "stage", unreadable);
  return null;
}

export function rowToJob(r: JobRow): Job | undefined {
  const state = JOB_STATES.find((known) => known === r.state);
  if (state === undefined) {
    warnOnce(`${r.id}:state`, `[jobs] job ${r.id} has an unknown state ${r.state}; leaving it out`);
    return undefined;
  }
  const unreadable: UnreadableColumn[] = [];
  const stage = stageOf(r, unreadable);
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
    state,
    stage,
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
