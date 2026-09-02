/**
 * SQLite schema for Conveyor's durable store (docs/DATA-MODEL.md). Kept as a
 * single idempotent DDL string so the migration runner can apply it on every
 * boot — `CREATE TABLE IF NOT EXISTS` makes first-run and restart identical.
 *
 * NOTE: this schema declares no FOREIGN KEY constraints despite openDb() setting
 * PRAGMA foreign_keys = ON, so nothing at the database level ties the tables together.
 * Nothing needs it any more: a job stores the printer and profile ids it used, and
 * those are historical facts about a finished run — deleting a printer today must not
 * rewrite what a job printed on last week. Rows are therefore intentionally
 * independent, and the job history keeps ids that may no longer resolve (surfaced as
 * empty rather than invented). Money/time columns are epoch-ms integers.
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

CREATE TABLE IF NOT EXISTS jobs (
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
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
`;
