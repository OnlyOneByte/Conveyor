/**
 * SQLite schema for Conveyor's durable store (docs/DATA-MODEL.md). Kept as a
 * single idempotent DDL string so the migration runner can apply it on every
 * boot — `CREATE TABLE IF NOT EXISTS` makes first-run and restart identical.
 *
 * Foreign keys are declared but PRAGMA foreign_keys is opt-in per-connection
 * (see openDb). Money/time columns are epoch-ms integers.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id            TEXT PRIMARY KEY,
  slicer_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,
  gcode_flavor  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS printers (
  id            TEXT PRIMARY KEY,
  transport_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  secrets_json  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stations (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  transport_id             TEXT NOT NULL,
  printer_id               TEXT NOT NULL,
  slicer_id                TEXT NOT NULL,
  profile_id               TEXT NOT NULL,
  allowed_generators_json  TEXT,
  created_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  generator_id  TEXT NOT NULL,
  params_json   TEXT,
  station_id    TEXT NOT NULL,
  state         TEXT NOT NULL,
  stage         TEXT,
  error_json    TEXT,
  model_path    TEXT,
  gcode_path    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
`;
