export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id                  TEXT PRIMARY KEY,
  slicer_id           TEXT NOT NULL,
  name                TEXT NOT NULL,
  path                TEXT NOT NULL,
  gcode_flavor        TEXT NOT NULL,
  orca_machine_json   TEXT,
  orca_process_json   TEXT,
  orca_filament_json  TEXT,
  prusa_ini           TEXT,
  created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS printers (
  id                       TEXT PRIMARY KEY,
  transport_id             TEXT NOT NULL,
  name                     TEXT NOT NULL,
  address                  TEXT NOT NULL,
  secrets_json             TEXT,
  allowed_generators_json  TEXT,
  created_at               INTEGER NOT NULL
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
  timings_json  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
`;
