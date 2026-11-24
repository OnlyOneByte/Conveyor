import type { Database } from "bun:sqlite";

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

interface SchemaObject {
  type: "index" | "trigger";
  name: string;
  sql: string;
}

const NAMES_STATION_SCHEMA = /\b(?:stations|station_id)\b/i;

const QUEUE_COLUMNS = [
  ["progress", "REAL"],
  ["message", "TEXT"],
  ["attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["max_attempts", "INTEGER NOT NULL DEFAULT 3"],
  ["run_after", "INTEGER NOT NULL DEFAULT 0"],
  ["lease_owner", "TEXT"],
  ["lease_token", "INTEGER NOT NULL DEFAULT 0"],
  ["lease_until", "INTEGER"],
  ["cancel_requested_at", "INTEGER"],
  ["submit_started_at", "INTEGER"],
  ["submitted_at", "INTEGER"],
  ["print_handle_json", "TEXT"],
] as const;

const PRINTER_COLUMNS = [
  ["hold_job_id", "TEXT"],
  ["hold_reason", "TEXT"],
  ["hold_at", "INTEGER"],
  ["last_seen_at", "INTEGER"],
  ["last_checked_at", "INTEGER"],
] as const;

function indexesAndTriggersOf(db: Database, table: string): SchemaObject[] {
  return db
    .query<SchemaObject, [string]>(
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND tbl_name = ? AND sql IS NOT NULL ORDER BY type = 'trigger'",
    )
    .all(table);
}

function isStationTrigger(object: SchemaObject): boolean {
  return object.type === "trigger" && NAMES_STATION_SCHEMA.test(object.sql);
}

function droppedTriggerKey(name: string): string {
  return `dropped_trigger:${name}`;
}

function warnDroppedTrigger(name: string): void {
  console.warn(
    `migration dropped trigger ${name} on jobs: it references the stations table or jobs.station_id, which the migration removes; its SQL is kept in meta under ${droppedTriggerKey(name)}`,
  );
}

export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  if (columnsOf(db, "jobs").includes("station_id")) {
    const hasStations = columnsOf(db, "stations").length > 0;
    const stationColumnOrNull = (col: string) =>
      hasStations ? `(SELECT s.${col} FROM stations s WHERE s.id = j.station_id)` : "NULL";
    const droppedTriggers = db.transaction(() => {
      const dependents = indexesAndTriggersOf(db, "jobs");
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
               ${stationColumnOrNull("printer_id")}, ${stationColumnOrNull("profile_id")},
               j.state, j.stage, j.error_json, j.model_path, j.gcode_path,
               j.created_at, j.updated_at
        FROM jobs j`);
      db.exec("DROP TABLE jobs");
      db.exec("ALTER TABLE jobs_migrated RENAME TO jobs");
      const stationTriggers = dependents.filter(isStationTrigger);
      for (const object of dependents.filter((dependent) => !isStationTrigger(dependent))) {
        db.exec(object.sql);
      }
      const keepSql = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
      for (const trigger of stationTriggers)
        keepSql.run(droppedTriggerKey(trigger.name), trigger.sql);
      return stationTriggers;
    })();
    for (const trigger of droppedTriggers) warnDroppedTrigger(trigger.name);
  }

  if (!columnsOf(db, "printers").includes("allowed_generators_json")) {
    db.exec("ALTER TABLE printers ADD COLUMN allowed_generators_json TEXT");
  }

  const profileColumns = new Set(columnsOf(db, "profiles"));
  for (const column of ["orca_machine_json", "orca_process_json", "orca_filament_json"]) {
    if (!profileColumns.has(column)) db.exec(`ALTER TABLE profiles ADD COLUMN ${column} TEXT`);
  }
  if (!profileColumns.has("prusa_ini")) db.exec("ALTER TABLE profiles ADD COLUMN prusa_ini TEXT");

  if (!columnsOf(db, "jobs").includes("timings_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN timings_json TEXT");
  }

  if (!columnsOf(db, "sessions").includes("password_version")) {
    db.exec("ALTER TABLE sessions ADD COLUMN password_version TEXT NOT NULL DEFAULT ''");
  }

  if (!columnsOf(db, "jobs").includes("filament_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN filament_json TEXT");
  }

  if (!columnsOf(db, "jobs").includes("dismissed_at")) {
    db.exec("ALTER TABLE jobs ADD COLUMN dismissed_at INTEGER");
  }

  if (!columnsOf(db, "jobs").includes("retried_by")) {
    db.exec("ALTER TABLE jobs ADD COLUMN retried_by TEXT");
  }

  if (!columnsOf(db, "jobs").includes("notes")) {
    db.exec("ALTER TABLE jobs ADD COLUMN notes TEXT");
  }

  const jobColumns = new Set(columnsOf(db, "jobs"));
  for (const [column, type] of QUEUE_COLUMNS) {
    if (!jobColumns.has(column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} ${type}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (state, run_after, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs (state, lease_until)");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_history ON jobs (updated_at DESC, id DESC)
    WHERE state IN ('done', 'failed', 'canceled')`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_printer_live ON jobs (printer_id, state)
    WHERE state IN ('generating', 'slicing', 'transferring', 'printing')`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_typical
    ON jobs (generator_id, printer_id, updated_at DESC, id DESC)
    WHERE state = 'done' AND timings_json IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_needs_you ON jobs (updated_at DESC, id DESC)
    WHERE state = 'failed' AND dismissed_at IS NULL AND retried_by IS NULL`);

  const printerColumns = new Set(columnsOf(db, "printers"));
  for (const [column, type] of PRINTER_COLUMNS) {
    if (!printerColumns.has(column)) db.exec(`ALTER TABLE printers ADD COLUMN ${column} ${type}`);
  }

  if (columnsOf(db, "stations").length > 0) {
    db.exec("DROP TABLE stations");
  }
}
