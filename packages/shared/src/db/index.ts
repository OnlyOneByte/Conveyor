import { Database } from "bun:sqlite";
import type { Job, JobState, JobTarget, StageTiming } from "../job.js";
import type { Stage } from "../plugins.js";
import type { OrcaProfileDocuments, PrusaProfileDocument } from "../profile.js";
import { migrate } from "./migrate.js";
import { SCHEMA_SQL } from "./schema.sql.js";
import { DEFAULT_PRINTERS, DEFAULT_PROFILES } from "./seed.js";
import { enableWal } from "./wal.js";

export interface Printer {
  id: string;
  transportId: string;
  name: string;
  address: string;
  secrets?: Record<string, string>;
  allowedGenerators?: string[];
}

export interface Profile {
  id: string;
  slicerId: string;
  name: string;
  path: string;
  gcodeFlavor: string;
  hasEditableContent?: boolean;
}

let singleton: Database | null = null;
let singletonPath: string | null = null;

export function openDb(path = process.env.DB_PATH ?? "/data/conveyor.db"): Database {
  if (singleton && singletonPath === path) return singleton;
  const db = new Database(path, { create: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  enableWal(db);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  migrate(db);
  seedDefaults(db);
  singleton = db;
  singletonPath = path;
  return db;
}

function countRows(db: Database, table: "printers" | "profiles"): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

function seedDefaults(db: Database): void {
  const now = epochMs();
  const insertProfile = db.prepare(
    "INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at) VALUES (?,?,?,?,?,?)",
  );
  const insertPrinter = db.prepare(
    "INSERT INTO printers (id, transport_id, name, address, secrets_json, created_at) VALUES (?,?,?,?,?,?)",
  );

  const tx = db.transaction(() => {
    const seeded = db.query<{ key: string }, []>("SELECT key FROM meta WHERE key = 'seeded'").get();
    if (seeded) return;
    db.exec("INSERT INTO meta (key, value) VALUES ('seeded', '1')");
    if (countRows(db, "printers") > 0 || countRows(db, "profiles") > 0) return;
    for (const p of DEFAULT_PROFILES)
      insertProfile.run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, now);
    for (const p of DEFAULT_PRINTERS)
      insertPrinter.run(
        p.id,
        p.transportId,
        p.name,
        p.address,
        p.secrets ? JSON.stringify(p.secrets) : null,
        now,
      );
  });
  tx.immediate();
}

function epochMs(): number {
  return Date.now();
}

interface PrinterRow {
  id: string;
  transport_id: string;
  name: string;
  address: string;
  secrets_json: string | null;
  allowed_generators_json: string | null;
}

function rowToPrinter(r: PrinterRow): Printer {
  return {
    id: r.id,
    transportId: r.transport_id,
    name: r.name,
    address: r.address,
    secrets: r.secrets_json ? JSON.parse(r.secrets_json) : undefined,
    allowedGenerators: r.allowed_generators_json
      ? (JSON.parse(r.allowed_generators_json) as string[])
      : undefined,
  };
}

export function dbGetPrinter(db: Database, id: string): Printer | undefined {
  const r = db.query("SELECT * FROM printers WHERE id = ?").get(id) as PrinterRow | null;
  return r ? rowToPrinter(r) : undefined;
}

export function dbListPrinters(db: Database): Printer[] {
  return (db.query("SELECT * FROM printers ORDER BY name").all() as PrinterRow[]).map(rowToPrinter);
}

export function dbUpsertPrinter(db: Database, p: Printer): void {
  db.prepare(
    `INSERT INTO printers (id, transport_id, name, address, secrets_json, allowed_generators_json, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       transport_id=excluded.transport_id, name=excluded.name,
       address=excluded.address,
       secrets_json=COALESCE(excluded.secrets_json, printers.secrets_json),
       allowed_generators_json=excluded.allowed_generators_json`,
  ).run(
    p.id,
    p.transportId,
    p.name,
    p.address,
    p.secrets ? JSON.stringify(p.secrets) : null,
    p.allowedGenerators ? JSON.stringify(p.allowedGenerators) : null,
    epochMs(),
  );
}

export function dbDeletePrinter(db: Database, id: string): void {
  db.prepare("DELETE FROM printers WHERE id = ?").run(id);
}

interface ProfileRow {
  id: string;
  slicer_id: string;
  name: string;
  path: string;
  gcode_flavor: string;
  orca_machine_json: string | null;
  orca_process_json: string | null;
  orca_filament_json: string | null;
  prusa_ini: string | null;
}

function rowToProfile(r: ProfileRow): Profile {
  const orcaEdited =
    r.orca_machine_json !== null && r.orca_process_json !== null && r.orca_filament_json !== null;
  const prusaEdited = r.prusa_ini !== null;
  return {
    id: r.id,
    slicerId: r.slicer_id,
    name: r.name,
    path: r.path,
    gcodeFlavor: r.gcode_flavor,
    ...(orcaEdited || prusaEdited ? { hasEditableContent: true } : {}),
  };
}

export function dbListProfiles(db: Database): Profile[] {
  return (db.query("SELECT * FROM profiles ORDER BY name").all() as ProfileRow[]).map(rowToProfile);
}

export function dbGetProfile(db: Database, id: string): Profile | null {
  const row = db.query("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | null;
  return row ? rowToProfile(row) : null;
}

interface OrcaDocumentsRow {
  orca_machine_json: string | null;
  orca_process_json: string | null;
  orca_filament_json: string | null;
}

export function dbGetOrcaProfileDocuments(db: Database, id: string): OrcaProfileDocuments | null {
  const row = db
    .query(
      "SELECT orca_machine_json, orca_process_json, orca_filament_json FROM profiles WHERE id = ?",
    )
    .get(id) as OrcaDocumentsRow | null;
  if (!row) return null;
  const {
    orca_machine_json: machine,
    orca_process_json: processDoc,
    orca_filament_json: filament,
  } = row;
  if (machine === null && processDoc === null && filament === null) return null;
  if (machine === null || processDoc === null || filament === null) {
    throw new Error(`profile ${id} has incomplete Orca content`);
  }
  return { machine, process: processDoc, filament };
}

export function dbSaveOrcaProfileDocuments(
  db: Database,
  id: string,
  documents: OrcaProfileDocuments,
): boolean {
  const result = db
    .prepare(
      `UPDATE profiles
       SET orca_machine_json = ?, orca_process_json = ?, orca_filament_json = ?
       WHERE id = ?`,
    )
    .run(documents.machine, documents.process, documents.filament, id);
  return result.changes > 0;
}

export function dbResetOrcaProfileDocuments(db: Database, id: string): boolean {
  const result = db
    .prepare(
      `UPDATE profiles
       SET orca_machine_json = NULL, orca_process_json = NULL, orca_filament_json = NULL
       WHERE id = ?`,
    )
    .run(id);
  return result.changes > 0;
}

export function dbGetPrusaProfileContent(db: Database, id: string): PrusaProfileDocument | null {
  const row = db.query("SELECT prusa_ini FROM profiles WHERE id = ?").get(id) as {
    prusa_ini: string | null;
  } | null;
  if (!row || row.prusa_ini === null) return null;
  return { config: row.prusa_ini };
}

export function dbSavePrusaProfileContent(
  db: Database,
  id: string,
  document: PrusaProfileDocument,
): boolean {
  const result = db
    .prepare("UPDATE profiles SET prusa_ini = ? WHERE id = ?")
    .run(document.config, id);
  return result.changes > 0;
}

export function dbResetPrusaProfileContent(db: Database, id: string): boolean {
  const result = db.prepare("UPDATE profiles SET prusa_ini = NULL WHERE id = ?").run(id);
  return result.changes > 0;
}

export function dbUpsertProfile(db: Database, p: Profile): void {
  db.prepare(
    `INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       slicer_id=excluded.slicer_id, name=excluded.name, path=excluded.path, gcode_flavor=excluded.gcode_flavor`,
  ).run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, epochMs());
}

export function dbDeleteProfile(db: Database, id: string): void {
  db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
}

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
