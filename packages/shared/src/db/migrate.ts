import type { Database } from "bun:sqlite";

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function indexSqlOf(db: Database, table: string): string[] {
  return db
    .query<{ sql: string }, [string]>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
    )
    .all(table)
    .map((row) => row.sql);
}

export function migrate(db: Database): void {
  if (columnsOf(db, "jobs").includes("station_id")) {
    const hasStations = columnsOf(db, "stations").length > 0;
    const stationColumnOrNull = (col: string) =>
      hasStations ? `(SELECT s.${col} FROM stations s WHERE s.id = j.station_id)` : "NULL";
    db.transaction(() => {
      const indexes = indexSqlOf(db, "jobs");
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
      for (const sql of indexes) db.exec(sql);
    })();
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

  if (columnsOf(db, "stations").length > 0) {
    db.exec("DROP TABLE stations");
  }

  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
}
