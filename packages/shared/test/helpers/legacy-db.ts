import { Database } from "bun:sqlite";

const LEGACY_STATION_SCHEMA = `
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

export function writeLegacyStationDb(path: string, extraSql: string): void {
  const legacy = new Database(path, { create: true });
  legacy.exec(LEGACY_STATION_SCHEMA + extraSql);
  legacy.exec(`INSERT INTO printers VALUES ('printer-a', 'moonraker', 'Legacy A', 'http://a', NULL, 1);
INSERT INTO profiles VALUES ('profile-a', 'orca', 'Legacy PLA', '/profiles/a', 'klipper', 1);
INSERT INTO stations VALUES
  ('st-a', 'Station A', 'moonraker', 'printer-a', 'orca', 'profile-a', NULL, 1),
  ('st-b', 'Station B', 'moonraker', 'printer-b', 'orca', 'profile-b', NULL, 1);
INSERT INTO jobs VALUES
  ('job-a', 'gen', NULL, 'st-a', 'done', NULL, NULL, NULL, NULL, 1, 1),
  ('job-b', 'gen', NULL, 'st-b', 'done', NULL, NULL, NULL, NULL, 2, 2),
  ('job-gone', 'gen', NULL, 'st-deleted', 'failed', NULL, NULL, NULL, NULL, 3, 3);`);
  legacy.close();
}
