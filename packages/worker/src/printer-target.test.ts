import { Database } from "bun:sqlite";
import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetPrinter, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { markPrinterSeen, resolvePrinterTarget } from "./printer-target";

const dir = mkdtempSync(join(tmpdir(), "conveyor-printer-target-"));
const db = openDb(join(dir, "conveyor.db"));
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const printer = { id: "p-secret", transportId: "moonraker", name: "P", address: "10.0.0.9" };

test("the transport target carries the decrypted secrets", () => {
  dbUpsertPrinter(db, { ...printer, secrets: { apiKey: "moonraker-key" } });
  expect(resolvePrinterTarget(db, "p-secret")).toEqual({
    id: "p-secret",
    transportId: "moonraker",
    address: "10.0.0.9",
    secrets: { apiKey: "moonraker-key" },
  });
});

test("the address and the secrets come from one snapshot, even when a move commits between the reads", () => {
  dbUpsertPrinter(db, { ...printer, id: "p-move", secrets: { apiKey: "new-key" } });
  const sealed =
    db.query<{ s: string }, []>("SELECT secrets_json AS s FROM printers WHERE id = 'p-move'").get()
      ?.s ?? "";
  dbUpsertPrinter(db, { ...printer, id: "p-move", secrets: { apiKey: "old-key" } });
  const other = new Database(join(dir, "conveyor.db"));
  const query = db.query.bind(db);
  let moved = false;
  const spy = spyOn(db, "query").mockImplementation((sql: string) => {
    if (!moved && sql.includes("SELECT secrets_json")) {
      moved = true;
      other
        .query("UPDATE printers SET address = ?, secrets_json = ? WHERE id = ?")
        .run("10.0.0.99", sealed, "p-move");
    }
    return query(sql);
  });
  try {
    const target = resolvePrinterTarget(db, "p-move");
    expect(moved).toBe(true);
    expect([target.address, target.secrets]).toEqual(["10.0.0.9", { apiKey: "old-key" }]);
    expect(resolvePrinterTarget(db, "p-move")).toMatchObject({
      address: "10.0.0.99",
      secrets: { apiKey: "new-key" },
    });
  } finally {
    spy.mockRestore();
    other.close();
  }
});

test("secrets that do not decrypt fail the transport stage without leaking them", () => {
  dbUpsertPrinter(db, { ...printer, id: "p-plain", secrets: { apiKey: "moonraker-key" } });
  db.exec(`UPDATE printers SET secrets_json = '{"apiKey":"plain-key"}' WHERE id = 'p-plain'`);
  expect(() => resolvePrinterTarget(db, "p-plain")).toThrow(
    "printer p-plain has stored secrets that cannot be decrypted",
  );
});

test("an unknown printer fails the transport stage", () => {
  expect(() => resolvePrinterTarget(db, "missing")).toThrow("unknown printer missing");
});

test("a printer a job heard from is marked seen and checked at that time", () => {
  dbUpsertPrinter(db, { ...printer, id: "p-seen" });
  markPrinterSeen(db, "p-seen", 42_000);
  expect(dbGetPrinter(db, "p-seen")).toMatchObject({ lastSeenAt: 42_000, lastCheckedAt: 42_000 });
});
