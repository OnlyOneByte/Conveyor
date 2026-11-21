import type { Database } from "bun:sqlite";

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

interface SchemaObject {
  type: "index" | "trigger";
  name: string;
  sql: string;
}

const NAMES_STATION_ID = /\bstation_id\b/i;

function indexesAndTriggersOf(db: Database, table: string): SchemaObject[] {
  return db
    .query<SchemaObject, [string]>(
      "SELECT type, name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND tbl_name = ? AND sql IS NOT NULL ORDER BY type = 'trigger'",
    )
    .all(table);
}

function isStationTrigger(object: SchemaObject): boolean {
  return object.type === "trigger" && NAMES_STATION_ID.test(object.sql);
}

function droppedTriggerKey(name: string): string {
  return `dropped_trigger:${name}`;
}

function warnDroppedTrigger(name: string): void {
  console.warn(
    `migration dropped trigger ${name} on jobs: it references jobs.station_id, which the migration removes; its SQL is kept in meta under ${droppedTriggerKey(name)}`,
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

  if (!columnsOf(db, "jobs").includes("notes")) {
    db.exec("ALTER TABLE jobs ADD COLUMN notes TEXT");
  }

  if (columnsOf(db, "stations").length > 0) {
    db.exec("DROP TABLE stations");
  }
}
