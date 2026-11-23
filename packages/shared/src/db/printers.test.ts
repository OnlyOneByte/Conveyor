import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dbGetPrinter,
  dbListPrinters,
  dbRecordPrinterCheck,
  dbUpsertPrinter,
  openDb,
} from "./index";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function withPrinter() {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-printers-"));
  dirs.push(dir);
  const db = openDb(join(dir, "conveyor.db"));
  dbUpsertPrinter(db, { id: "p1", transportId: "moonraker", name: "P1", address: "10.0.0.9" });
  const seen = () => {
    const printer = dbGetPrinter(db, "p1");
    return { lastSeenAt: printer?.lastSeenAt, lastCheckedAt: printer?.lastCheckedAt };
  };
  return { db, seen };
}

describe("printer checks", () => {
  test("a printer never checked has neither time", () => {
    const { db, seen } = withPrinter();
    expect(seen()).toEqual({ lastSeenAt: undefined, lastCheckedAt: undefined });
    expect(JSON.stringify(dbListPrinters(db))).not.toMatch(/last(Seen|Checked)At/);
  });

  test("a printer going offline keeps the time it was last seen", () => {
    const { db, seen } = withPrinter();
    dbRecordPrinterCheck(db, "p1", { at: 1_000, reachable: true });
    expect(seen()).toEqual({ lastSeenAt: 1_000, lastCheckedAt: 1_000 });
    dbRecordPrinterCheck(db, "p1", { at: 61_000, reachable: false });
    expect(seen()).toEqual({ lastSeenAt: 1_000, lastCheckedAt: 61_000 });
    dbRecordPrinterCheck(db, "p1", { at: 121_000, reachable: true });
    expect(seen()).toEqual({ lastSeenAt: 121_000, lastCheckedAt: 121_000 });
  });

  test("a printer that has never answered is checked but not seen", () => {
    const { db, seen } = withPrinter();
    dbRecordPrinterCheck(db, "p1", { at: 5_000, reachable: false });
    expect(seen()).toEqual({ lastSeenAt: undefined, lastCheckedAt: 5_000 });
  });

  test("a check that finishes late does not move either time back", () => {
    const { db, seen } = withPrinter();
    dbRecordPrinterCheck(db, "p1", { at: 9_000, reachable: true });
    dbRecordPrinterCheck(db, "p1", { at: 4_000, reachable: true });
    dbRecordPrinterCheck(db, "p1", { at: 3_000, reachable: false });
    expect(seen()).toEqual({ lastSeenAt: 9_000, lastCheckedAt: 9_000 });
  });

  test("checking an unknown printer changes nothing", () => {
    const { db, seen } = withPrinter();
    dbRecordPrinterCheck(db, "ghost", { at: 1_000, reachable: true });
    expect(seen()).toEqual({ lastSeenAt: undefined, lastCheckedAt: undefined });
    expect(dbGetPrinter(db, "ghost")).toBeUndefined();
  });
});
