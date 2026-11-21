import type { Database } from "bun:sqlite";
import type { Job, JobState, JobTarget, StageTiming } from "../job.js";
import type { Stage } from "../plugins.js";
import { epochMs } from "./epoch-ms.js";
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
  created_at: number;
  updated_at: number;
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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function dbRecordJob(
  db: Database,
  job: {
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
  },
): void {
  const now = epochMs();
  db.prepare(
    `INSERT INTO jobs (id, generator_id, params_json, printer_id, profile_id, state, stage, error_json, model_path, gcode_path, timings_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       state=excluded.state, stage=excluded.stage, error_json=excluded.error_json,
       model_path=excluded.model_path, gcode_path=excluded.gcode_path,
       timings_json=excluded.timings_json, updated_at=excluded.updated_at`,
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
    now,
    now,
  );
}

export function dbListJobs(db: Database, limit = 50): Job[] {
  return (
    db.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[]
  ).map(rowToJob);
}

export function dbGetJob(db: Database, id: string): Job | null {
  const row = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
  return row ? rowToJob(row) : null;
}
