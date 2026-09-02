import { Database } from "bun:sqlite";
import type { Job, JobState, JobTarget } from "../job.js";
import type { Stage } from "../plugins.js";
import { SCHEMA_SQL } from "./schema.sql.js";
import { DEFAULT_PROFILES, DEFAULT_PRINTERS } from "./seed.js";

/**
 * Conveyor's durable store, backed by bun:sqlite (synchronous, no native build —
 * works the same on aarch64 and x86_64). Both the API (config reads + job
 * history) and the worker (print-target resolution + terminal job writes) open the
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
  /**
   * Generator ids this printer accepts. `undefined` means no restriction — which is
   * deliberately distinct from `[]`, an empty allowlist that permits nothing. Unlike
   * `secrets` this IS returned to clients, so a form can round-trip it.
   */
  allowedGenerators?: string[];
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
  migrate(db);
  seedDefaults(db);
  singleton = db;
  singletonPath = path;
  return db;
}

/** Column names of an existing table (empty when the table does not exist). */
function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/**
 * Reshape tables that already exist in the wild. SCHEMA_SQL is `CREATE TABLE IF NOT
 * EXISTS` only, so it CANNOT change a table that is already there — a column added to
 * the DDL is simply absent from any database created before it, and the first INSERT
 * naming that column fails at runtime. Each step below is therefore guarded on the
 * LIVE table shape and is safe to run on every boot.
 */
function migrate(db: Database): void {
  // jobs.station_id → jobs.printer_id + jobs.profile_id
  //
  // A full table rebuild rather than ALTER TABLE ADD COLUMN, because station_id was
  // declared NOT NULL: merely adding the new columns would leave the old one in place
  // and every future insert would fail the NOT NULL constraint. SQLite cannot drop a
  // constraint in place, so the 12-step rebuild is the supported route.
  //
  // The backfill is lossless: a station WAS exactly the (printer, profile) pair we now
  // store directly, so its two ids are recoverable for as long as the row exists. A job
  // whose station was already deleted backfills to NULL — its provenance is genuinely
  // gone, and that is surfaced as an empty printer/profile rather than invented.
  if (columnsOf(db, "jobs").includes("station_id")) {
    const hasStations = columnsOf(db, "stations").length > 0;
    const lookup = (col: string) =>
      hasStations ? `(SELECT s.${col} FROM stations s WHERE s.id = j.station_id)` : "NULL";
    db.transaction(() => {
      db.exec(`CREATE TABLE jobs_migrated (
        id            TEXT PRIMARY KEY,
        generator_id  TEXT NOT NULL,
        params_json   TEXT,
        printer_id    TEXT,
        profile_id    TEXT,
        state         TEXT NOT NULL,
        stage         TEXT,
        error_json    TEXT,
        model_path    TEXT,
        gcode_path    TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      )`);
      db.exec(`INSERT INTO jobs_migrated
        SELECT j.id, j.generator_id, j.params_json,
               ${lookup("printer_id")}, ${lookup("profile_id")},
               j.state, j.stage, j.error_json, j.model_path, j.gcode_path,
               j.created_at, j.updated_at
        FROM jobs j`);
      db.exec("DROP TABLE jobs");
      db.exec("ALTER TABLE jobs_migrated RENAME TO jobs");
    })();
  }

  // printers.allowed_generators_json — a per-printer generator allowlist. Additive and
  // nullable, so a plain ADD COLUMN suffices; no table rebuild (contrast the jobs
  // rebuild above, which was forced by a NOT NULL column that had to go).
  if (!columnsOf(db, "printers").includes("allowed_generators_json")) {
    db.exec("ALTER TABLE printers ADD COLUMN allowed_generators_json TEXT");
  }

  // Then retire the stations table itself. A SEPARATE guard, not an else of the one
  // above: a database migrated by an earlier build already has printer_id on jobs yet
  // may still carry the stations table, and that case must still be cleaned up.
  // Ordering matters — the backfill above reads this table, so it must run first.
  if (columnsOf(db, "stations").length > 0) {
    db.exec("DROP TABLE stations");
  }
}

/** Seed the default catalog the project shipped with — only when empty, so user
 * edits made in Settings are never clobbered on restart. */
function seedDefaults(db: Database): void {
  const count = (db.query("SELECT COUNT(*) AS n FROM printers").get() as { n: number }).n;
  if (count > 0) return;

  const now = epochMs();
  const insertProfile = db.prepare(
    "INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at) VALUES (?,?,?,?,?,?)",
  );
  const insertPrinter = db.prepare(
    "INSERT INTO printers (id, transport_id, name, address, secrets_json, created_at) VALUES (?,?,?,?,?,?)",
  );

  const tx = db.transaction(() => {
    for (const p of DEFAULT_PROFILES) insertProfile.run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, now);
    for (const p of DEFAULT_PRINTERS)
      insertPrinter.run(p.id, p.transportId, p.name, p.address, p.secrets ? JSON.stringify(p.secrets) : null, now);
  });
  tx();
}

function epochMs(): number {
  return Date.now();
}


// ─── Printers ────────────────────────────────────────────────────────────────

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
    // `?? undefined` not `|| undefined`: "[]" parses to [], which is a meaningful
    // allow-nothing list and must not collapse into "no restriction".
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
  // NOTE the COALESCE on secrets_json. Reads strip secrets (only `hasSecrets` is
  // returned), so a client editing a printer CANNOT round-trip them — it can only
  // send new ones or none. Assigning excluded.secrets_json directly therefore wiped
  // the stored credential every time someone changed, say, just the address.
  // Semantics now:
  //   secrets omitted  → keep whatever is stored
  //   secrets {}       → clear them
  //   secrets {...}    → replace them
  //
  // allowed_generators_json is assigned DIRECTLY, not COALESCEd, and that asymmetry is
  // deliberate: unlike secrets it is returned on read, so a client can round-trip it
  // and "omitted" is an intentional choice meaning "no restriction". COALESCE here
  // would make an allowlist impossible to remove.
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

export function dbDeleteProfile(db: Database, id: string): void {
  db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
}

/**
 * Resolve the (printer, profile) pair a job names into a full JobTarget, deriving the
 * transport from the printer and the slicer + g-code flavour from the profile. Returns
 * null when either id is unknown, so callers can answer 400 rather than enqueue a job
 * that cannot run. This replaces looking a Station up by id.
 */
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
    slicerId: profile.slicerId,
    gcodeFlavor: profile.gcodeFlavor,
    allowedGenerators: printer.allowedGenerators,
  };
}

// ─── Jobs (durable history) ──────────────────────────────────────────────────

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
  created_at: number;
  updated_at: number;
}

function rowToJob(r: JobRow): Job {
  return {
    id: r.id,
    // printer/profile can be null on a job migrated from a station that had already
    // been deleted — surfaced as empty rather than fabricated.
    request: {
      generator: { id: r.generator_id, params: r.params_json ? JSON.parse(r.params_json) : undefined },
      printerId: r.printer_id ?? "",
      profileId: r.profile_id ?? "",
    },
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
    printerId: string;
    profileId: string;
    state: JobState;
    stage?: Stage | null;
    error?: { stage: Stage; reason: string };
    modelPath?: string;
    gcodePath?: string;
  },
): void {
  const now = epochMs();
  db.prepare(
    `INSERT INTO jobs (id, generator_id, params_json, printer_id, profile_id, state, stage, error_json, model_path, gcode_path, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       state=excluded.state, stage=excluded.stage, error_json=excluded.error_json,
       model_path=excluded.model_path, gcode_path=excluded.gcode_path, updated_at=excluded.updated_at`,
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
    now,
    now,
  );
}

export function dbListJobs(db: Database, limit = 50): Job[] {
  return (db.query("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[]).map(rowToJob);
}

/**
 * One settled job by id. The detail page needs this rather than filtering
 * dbListJobs(): that list is windowed (50 by default, 200 max), so a deep link to
 * an older job would resolve to "not found" purely because it fell off the window.
 */
export function dbGetJob(db: Database, id: string): Job | null {
  const row = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
  return row ? rowToJob(row) : null;
}
