import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetPrinter, dbGetPrinterSecrets, dbUpsertPrinter, openDb } from "./index";
import { resolveSecretsKey } from "./printer-secrets";
import { SCHEMA_SQL } from "./schema.sql";

const KEY_A = { CONVEYOR_SECRETS_KEY: randomBytes(32).toString("base64") };
const KEY_B = { CONVEYOR_SECRETS_KEY: randomBytes(32).toString("base64") };
const PLAINTEXT = '{"apiKey":"moonraker-key-123"}';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dbWithPlaintextRows(): string {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-secrets-"));
  dirs.push(dir);
  const path = join(dir, "conveyor.db");
  const raw = new Database(path);
  raw.exec(SCHEMA_SQL);
  const insert = raw.prepare(
    "INSERT INTO printers (id, transport_id, name, address, secrets_json, created_at) VALUES (?, 'moonraker', ?, '10.0.0.9', ?, 0)",
  );
  insert.run("with-key", "With key", PLAINTEXT);
  insert.run("no-key", "No key", null);
  insert.run("odd", "Odd", "v1:looks-sealed");
  insert.run("bad-shape", "Bad shape", '{"apiKey":5}');
  raw.close();
  return path;
}

function reopen(path: string, env: Record<string, string>) {
  openDb(":memory:").close();
  return openDb(path, env);
}

const storedOf = (db: Database, id: string) =>
  db
    .query<{ s: string | null }, [string]>("SELECT secrets_json AS s FROM printers WHERE id = ?")
    .get(id)?.s;

describe("printer secrets at rest", () => {
  test("the first open encrypts plaintext rows and reads them back", () => {
    const db = reopen(dbWithPlaintextRows(), KEY_A);
    expect(storedOf(db, "with-key")).toStartWith("v1:");
    expect(storedOf(db, "with-key")).not.toContain("moonraker-key-123");
    expect(storedOf(db, "no-key")).toBeNull();
    expect(storedOf(db, "odd")).toBe("v1:looks-sealed");
    expect(dbGetPrinterSecrets(db, "no-key")).toEqual({ ok: true, value: undefined });
    expect(dbGetPrinterSecrets(db, "bad-shape").ok).toBe(false);
    expect(dbGetPrinterSecrets(db, "with-key")).toEqual({
      ok: true,
      value: { apiKey: "moonraker-key-123" },
    });
    expect(dbGetPrinter(db, "with-key")?.hasSecrets).toBe(true);
    expect(dbGetPrinter(db, "no-key")?.hasSecrets).toBe(false);
  });

  test("a later open leaves encrypted rows untouched and refuses plaintext", () => {
    const path = dbWithPlaintextRows();
    const sealed = storedOf(reopen(path, KEY_A), "with-key");
    reopen(path, KEY_A).exec(
      `UPDATE printers SET secrets_json = '${PLAINTEXT}' WHERE id = 'no-key'`,
    );
    const db = reopen(path, KEY_A);
    expect(storedOf(db, "with-key")).toBe(sealed ?? "missing");
    expect(storedOf(db, "no-key")).toBe(PLAINTEXT);
    expect(dbGetPrinterSecrets(db, "no-key")).toEqual({
      ok: false,
      error: { kind: "PrinterSecretsUnreadable", printerId: "no-key" },
    });
  });

  test("a sealed value copied to another printer does not decrypt", () => {
    const db = reopen(dbWithPlaintextRows(), KEY_A);
    db.exec(
      "UPDATE printers SET secrets_json = (SELECT secrets_json FROM printers WHERE id = 'with-key')",
    );
    expect(dbGetPrinterSecrets(db, "no-key").ok).toBe(false);
  });

  test("an in-memory database gets a fresh key that is never written to disk", () => {
    const first = resolveSecretsKey(":memory:", {}).bytes;
    expect(resolveSecretsKey(":memory:", {}).bytes.equals(first)).toBe(false);
  });

  test("a failure partway through the migration rolls every row back", () => {
    const path = dbWithPlaintextRows();
    const raw = new Database(path);
    raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    raw.exec(`CREATE TRIGGER fail_second_row BEFORE UPDATE ON printers WHEN OLD.id = 'bad-shape'
      BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END`);
    expect(() => reopen(path, KEY_A)).toThrow("injected migration failure");
    expect(storedOf(raw, "with-key")).toBe(PLAINTEXT);
    expect(storedOf(raw, "bad-shape")).toBe('{"apiKey":5}');
    expect(raw.query("SELECT key FROM meta WHERE key = 'secrets_key_check'").get()).toBeNull();
    raw.close();
  });

  test("opening with a different key refuses to start", () => {
    const path = dbWithPlaintextRows();
    reopen(path, KEY_A);
    expect(() => reopen(path, KEY_B)).toThrow("encrypted with a different key");
  });

  test("a malformed CONVEYOR_SECRETS_KEY refuses to start", () => {
    expect(() => reopen(dbWithPlaintextRows(), { CONVEYOR_SECRETS_KEY: "short" })).toThrow(
      "[secrets] refusing to start: CONVEYOR_SECRETS_KEY must be exactly 32 bytes",
    );
  });

  test("an upsert encrypts new secrets, keeps them when omitted and clears them on {}", () => {
    const db = reopen(dbWithPlaintextRows(), KEY_A);
    const printer = { id: "no-key", transportId: "moonraker", name: "N", address: "10.0.0.9" };
    dbUpsertPrinter(db, { ...printer, secrets: { apiKey: "fresh-key" } });
    expect(storedOf(db, "no-key")).not.toContain("fresh-key");
    dbUpsertPrinter(db, printer);
    expect(dbGetPrinterSecrets(db, "no-key")).toEqual({ ok: true, value: { apiKey: "fresh-key" } });
    dbUpsertPrinter(db, { ...printer, secrets: {} });
    expect(storedOf(db, "no-key")).toBeNull();
  });
});
