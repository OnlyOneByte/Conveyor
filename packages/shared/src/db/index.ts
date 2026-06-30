import { Database } from "bun:sqlite";
import type { Station } from "../station.js";
import type { Job, JobState } from "../job.js";
import type { Stage } from "../plugins.js";
import { SCHEMA_SQL } from "./schema.sql.js";
import { DEFAULT_PROFILES, DEFAULT_PRINTERS, DEFAULT_STATIONS } from "./seed.js";

/**
 * Conveyor's durable store, backed by bun:sqlite (synchronous, no native build —
 * works the same on aarch64 and x86_64). Both the API (config reads + job
 * history) and the worker (station resolution + terminal job writes) open the
 * SAME file on the shared /data volume, so there is one source of truth.
 *
 * Process-wide singleton: openDb() is idempotent per path.
 */
export interface Printer {
  id: string;
  transportId: string;
  name: string;
  address: string;
  /** parsed from secrets_json; server-side only, never serialized to clients */
  secrets?: Record<string, string>;
}

export interface Profile {
  id: string;
  slicerId: string;
  name: string;
  path: string;
  gcodeFlavor: string;
}

let singleton: Database | null = null;
let singletonPath: string | null = null;

export function openDb(path = process.env.DB_PATH ?? "/data/conveyor.db"): Database {
  if (singleton && singletonPath === path) return singleton;
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  seedDefaults(db);
  singleton = db;
  singletonPath = path;
  return db;
}

/** Seed the default catalog the project shipped with — only when empty, so user
 * edits via the admin panel are never clobbered on restart. */
function seedDefaults(db: Database): void {
  const count = (db.query("SELECT COUNT(*) AS n FROM stations").get() as { n: number }).n;
  if (count > 0) return;

  const now = epochMs();
  const insertProfile = db.prepare(
    "INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at) VALUES (?,?,?,?,?,?)",
  );
  const insertPrinter = db.prepare(
    "INSERT INTO printers (id, transport_id, name, address, secrets_json, created_at) VALUES (?,?,?,?,?,?)",
  );
  const insertStation = db.prepare(
    "INSERT INTO stations (id, name, transport_id, printer_id, slicer_id, profile_id, allowed_generators_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
  );

  const tx = db.transaction(() => {
    for (const p of DEFAULT_PROFILES) insertProfile.run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, now);
    for (const p of DEFAULT_PRINTERS)
      insertPrinter.run(p.id, p.transportId, p.name, p.address, p.secrets ? JSON.stringify(p.secrets) : null, now);
    for (const s of DEFAULT_STATIONS)
      insertStation.run(
        s.id,
        s.name,
        s.transportId,
        s.printerId,
        s.slicerId,
        s.profileId,
        s.allowedGenerators ? JSON.stringify(s.allowedGenerators) : null,
        now,
      );
  });
  tx();
}

function epochMs(): number {
  return Date.now();
}

// ─── Stations ────────────────────────────────────────────────────────────────

interface StationRow {
  id: string;
  name: string;
  transport_id: string;
  printer_id: string;
  slicer_id: string;
  profile_id: string;
  allowed_generators_json: string | null;
}

function rowToStation(r: StationRow): Station {
  return {
    id: r.id,
    name: r.name,
    transportId: r.transport_id,
    printerId: r.printer_id,
    slicerId: r.slicer_id,
    profileId: r.profile_id,
    allowedGenerators: r.allowed_generators_json ? JSON.parse(r.allowed_generators_json) : undefined,
  };
}

export function dbListStations(db: Database): Station[] {
  return (db.query("SELECT * FROM stations ORDER BY name").all() as StationRow[]).map(rowToStation);
}

export function dbGetStation(db: Database, id: string): Station | undefined {
  const r = db.query("SELECT * FROM stations WHERE id = ?").get(id) as StationRow | null;
  return r ? rowToStation(r) : undefined;
}

export function dbUpsertStation(db: Database, s: Station): void {
  db.prepare(
    `INSERT INTO stations (id, name, transport_id, printer_id, slicer_id, profile_id, allowed_generators_json, created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, transport_id=excluded.transport_id, printer_id=excluded.printer_id,
       slicer_id=excluded.slicer_id, profile_id=excluded.profile_id,
       allowed_generators_json=excluded.allowed_generators_json`,
  ).run(
    s.id,
    s.name,
    s.transportId,
    s.printerId,
    s.slicerId,
    s.profileId,
    s.allowedGenerators ? JSON.stringify(s.allowedGenerators) : null,
    epochMs(),
  );
}

export function dbDeleteStation(db: Database, id: string): void {
  db.prepare("DELETE FROM stations WHERE id = ?").run(id);
}

// ─── Printers ────────────────────────────────────────────────────────────────

interface PrinterRow {
  id: string;
  transport_id: string;
  name: string;
  address: string;
  secrets_json: string | null;
}

function rowToPrinter(r: PrinterRow): Printer {
  return {
    id: r.id,
    transportId: r.transport_id,
    name: r.name,
    address: r.address,
    secrets: r.secrets_json ? JSON.parse(r.secrets_json) : undefined,
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
    `INSERT INTO printers (id, transport_id, name, address, secrets_json, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       transport_id=excluded.transport_id, name=excluded.name,
       address=excluded.address, secrets_json=excluded.secrets_json`,
  ).run(p.id, p.transportId, p.name, p.address, p.secrets ? JSON.stringify(p.secrets) : null, epochMs());
}

// ─── Profiles ────────────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  slicer_id: string;
  name: string;
  path: string;
  gcode_flavor: string;
}

function rowToProfile(r: ProfileRow): Profile {
  return { id: r.id, slicerId: r.slicer_id, name: r.name, path: r.path, gcodeFlavor: r.gcode_flavor };
}

export function dbListProfiles(db: Database): Profile[] {
  return (db.query("SELECT * FROM profiles ORDER BY name").all() as ProfileRow[]).map(rowToProfile);
}

export function dbUpsertProfile(db: Database, p: Profile): void {
  db.prepare(
    `INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       slicer_id=excluded.slicer_id, name=excluded.name, path=excluded.path, gcode_flavor=excluded.gcode_flavor`,
  ).run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, epochMs());
}

// ─── Jobs (durable history) ──────────────────────────────────────────────────

interface JobRow {
  id: string;
  generator_id: string;
  params_json: string | null;
  station_id: string;
  state: string;
  stage: string | null;
  error_json: string | null;
  model_path: string | null;
  gcode_path: string | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(r: JobRow): Job {
  return {
    id: r.id,
    request: { generator: { id: r.generator_id, params: r.params_json ? JSON.parse(r.params_json) : undefined }, stationId: r.station_id },
    state: r.state as JobState,
    stage: (r.stage as Stage) ?? null,
    error: r.error_json ? JSON.parse(r.error_json) : undefined,
    artifacts: { model: r.model_path ?? undefined, gcode: r.gcode_path ?? undefined },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Write the settled record of a finished pipeline run (terminal state). */
export function dbRecordJob(
  db: Database,
  job: {
    id: string;
    generatorId: string;
    params?: unknown;
    stationId: string;
    state: JobState;
    stage?: Stage | null;
    error?: { stage: Stage; reason: string };
    modelPath?: string;
    gcodePath?: string;
  },
): void {
  const now = epochMs();
  db.prepare(
    `INSERT INTO jobs (id, generator_id, params_json, station_id, state, stage, error_json, model_path, gcode_path, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       state=excluded.state, stage=excluded.stage, error_json=excluded.error_json,
       model_path=excluded.model_path, gcode_path=excluded.gcode_path, updated_at=excluded.updated_at`,
  ).run(
    job.id,
    job.generatorId,
    job.params !== undefined ? JSON.stringify(job.params) : null,
    job.stationId,
    job.state,
    job.stage ?? null,
    job.error ? JSON.stringify(job.error) : null,
    job.modelPath ?? null,
    job.gcodePath ?? null,
    now,
    now,
  );
}

export function dbListJobs(db: Database, limit = 50): Job[] {
  return (db.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[]).map(rowToJob);
}
