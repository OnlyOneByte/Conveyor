import { Database } from "bun:sqlite";
import {
  dbUpsertPrinter,
  dbUpsertProfile,
  type Printer,
  type Profile,
} from "../../src/db/index.ts";
import { SCHEMA_SQL } from "../../src/db/schema.sql.ts";
import { DEFAULT_PRINTERS, DEFAULT_PROFILES } from "../../src/db/seed.ts";

export interface TestDbOptions {
  seed?: boolean;
  printers?: Printer[];
  profiles?: Profile[];
}

export function createTestDb(options: TestDbOptions = {}): Database {
  const db = new Database(":memory:");
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
