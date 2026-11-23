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
  created_at               INTEGER NOT NULL,
  hold_job_id              TEXT,
  hold_reason              TEXT,
  hold_at                  INTEGER,
  last_seen_at             INTEGER,
  last_checked_at          INTEGER
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
  filament_json TEXT,
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  progress            REAL,
  message             TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  run_after           INTEGER NOT NULL DEFAULT 0,
  lease_owner         TEXT,
  lease_token         INTEGER NOT NULL DEFAULT 0,
  lease_until         INTEGER,
  cancel_requested_at INTEGER,
  submit_started_at   INTEGER,
  submitted_at        INTEGER,
  print_handle_json   TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  TEXT    NOT NULL,
  event   TEXT    NOT NULL,
  at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, seq);

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT    PRIMARY KEY,
  expires_at       INTEGER NOT NULL,
  password_version TEXT    NOT NULL DEFAULT ''
);
`;
