import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerOnlyDbFiles } from "./owner-only";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const modeOf = (path: string) => (statSync(path).mode & 0o777).toString(8);

test("creates a missing database and its directory owner-only", () => {
  dir = mkdtempSync(join(tmpdir(), "conveyor-owner-only-"));
  const path = join(dir, "data", "conveyor.db");
  ownerOnlyDbFiles(path);
  expect(modeOf(join(dir, "data"))).toBe("700");
  expect(modeOf(path)).toBe("600");
});

test("tightens an existing database, WAL and SHM that others can read", () => {
  dir = mkdtempSync(join(tmpdir(), "conveyor-owner-only-"));
  const path = join(dir, "conveyor.db");
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    writeFileSync(file, "");
    chmodSync(file, 0o644);
  }
  ownerOnlyDbFiles(path);
  expect([path, `${path}-wal`, `${path}-shm`].map(modeOf)).toEqual(["600", "600", "600"]);
});

test("leaves an in-memory database alone", () => {
  dir = mkdtempSync(join(tmpdir(), "conveyor-owner-only-"));
  expect(() => ownerOnlyDbFiles(":memory:")).not.toThrow();
});
