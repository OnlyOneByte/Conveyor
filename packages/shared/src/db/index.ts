import { Database } from "bun:sqlite";
import { migrate } from "./migrate.js";
import { ownerOnlyDbFiles } from "./owner-only.js";
import { bindSecretsKey, encryptPlaintextSecrets, resolveSecretsKey } from "./printer-secrets.js";
import { SCHEMA_SQL } from "./schema.sql.js";
import { DEFAULT_PRINTERS, DEFAULT_PROFILES } from "./seed.js";
import { enableWal } from "./wal.js";

export * from "./jobs.js";
export { dbGetPrinterSecrets, SecretsKeyError } from "./printer-secrets.js";
export * from "./printers.js";
export * from "./profiles.js";
export * from "./retry-claims.js";
export { DEFAULT_PROFILES } from "./seed.js";
export * from "./sessions.js";
export * from "./typical.js";
export * from "./worker-heartbeat.js";

let singleton: Database | null = null;

function isOpen(db: Database): boolean {
  try {
    return db.inTransaction !== undefined;
  } catch {
    return false;
  }
}
let singletonPath: string | null = null;

export function openDb(
  path = process.env.DB_PATH ?? "/data/conveyor.db",
  env: Record<string, string | undefined> = process.env,
): Database {
  if (singleton && singletonPath === path && isOpen(singleton)) return singleton;
  ownerOnlyDbFiles(path);
  const key = resolveSecretsKey(path, env);
  const db = new Database(path, { create: true });
  bindSecretsKey(db, key);
  db.exec("PRAGMA busy_timeout = 5000;");
  enableWal(db);
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  db.transaction(() => {
    migrate(db);
    encryptPlaintextSecrets(db);
  }).immediate();
  seedDefaults(db);
  singleton = db;
  singletonPath = path;
  return db;
}

function countRows(db: Database, table: "printers" | "profiles"): number {
  return db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
}

function seedDefaults(db: Database): void {
  const now = Date.now();
  const insertProfile = db.prepare(
    "INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at) VALUES (?,?,?,?,?,?)",
  );
  const insertPrinter = db.prepare(
    "INSERT INTO printers (id, transport_id, name, address, secrets_json, created_at) VALUES (?,?,?,?,?,?)",
  );

  const tx = db.transaction(() => {
    const seeded = db.query<{ key: string }, []>("SELECT key FROM meta WHERE key = 'seeded'").get();
    if (seeded) return;
    db.exec("INSERT INTO meta (key, value) VALUES ('seeded', '1')");
    if (countRows(db, "printers") > 0 || countRows(db, "profiles") > 0) return;
    for (const p of DEFAULT_PROFILES)
      insertProfile.run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, now);
    for (const p of DEFAULT_PRINTERS)
      insertPrinter.run(p.id, p.transportId, p.name, p.address, null, now);
  });
  tx.immediate();
}
