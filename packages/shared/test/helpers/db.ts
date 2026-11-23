import { Database } from "bun:sqlite";
import {
  dbUpsertPrinter,
  dbUpsertProfile,
  type PrinterInput,
  type Profile,
} from "../../src/db/index.ts";
import { bindSecretsKey, resolveSecretsKey } from "../../src/db/printer-secrets.ts";
import { SCHEMA_SQL } from "../../src/db/schema.sql.ts";
import { DEFAULT_PRINTERS, DEFAULT_PROFILES } from "../../src/db/seed.ts";

export interface TestDbOptions {
  seed?: boolean;
  printers?: PrinterInput[];
  profiles?: Profile[];
}

export function createTestDb(options: TestDbOptions = {}): Database {
  const db = new Database(":memory:");
  bindSecretsKey(db, resolveSecretsKey(":memory:", {}));
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  const seed = options.seed ?? true;
  for (const profile of options.profiles ?? (seed ? DEFAULT_PROFILES : [])) {
    dbUpsertProfile(db, profile);
  }
  for (const printer of options.printers ?? (seed ? DEFAULT_PRINTERS : [])) {
    dbUpsertPrinter(db, printer);
  }
  return db;
}
