import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StageError } from "../../src/context.ts";
import {
  dbGetJob,
  dbListPrinters,
  dbListProfiles,
  dbRecordJob,
  dbResolveJobTarget,
  openDb,
} from "../../src/db/index.ts";
import { DEFAULT_PRINTERS, DEFAULT_PROFILES } from "../../src/db/seed.ts";
import {
  createTestDb,
  FIXED_EPOCH_MS,
  fixedClock,
  STUB_GCODE,
  stubSlicer,
  testCtx,
} from "./index.ts";
import { fakeTransport } from "./transport.ts";

const shape = (db: Database) =>
  ["profiles", "printers", "jobs"].map((table) => db.query(`PRAGMA table_info(${table})`).all());

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("createTestDb", () => {
  test("seeds the default catalog into a private in-memory database", () => {
    const a = createTestDb();
    const b = createTestDb({ seed: false });
    expect(dbListPrinters(a)).toHaveLength(DEFAULT_PRINTERS.length);
    expect(dbListProfiles(a)).toHaveLength(DEFAULT_PROFILES.length);
    expect(dbListPrinters(b)).toEqual([]);
  });

  test("matches the table shape openDb creates on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-db-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(shape(createTestDb())).toEqual(shape(openDb(join(dir, "conveyor.db"))));
  });

  test("resolves a job target from custom rows", () => {
    const db = createTestDb({
      printers: [{ id: "p1", transportId: "fake", name: "P1", address: "10.0.0.2" }],
      profiles: [{ id: "s/x", slicerId: "stub", name: "X", path: "/x", gcodeFlavor: "klipper" }],
    });
    expect(dbResolveJobTarget(db, "p1", "s/x")).toMatchObject({
      transportId: "fake",
      slicerId: "stub",
      gcodeFlavor: "klipper",
    });
  });
});

describe("fixedClock", () => {
  test("pins Date.now and advances on demand", () => {
    const clock = fixedClock();
    cleanups.push(clock.restore);
    expect(Date.now()).toBe(FIXED_EPOCH_MS);
    expect(clock.advance(1500)).toBe(FIXED_EPOCH_MS + 1500);
    expect(Date.now()).toBe(FIXED_EPOCH_MS + 1500);
  });

  test("stamps rows written through the store", () => {
    const clock = fixedClock();
    cleanups.push(clock.restore);
    const db = createTestDb();
    dbRecordJob(db, {
      id: "j1",
      generatorId: "gridfinity",
      printerId: "p",
      profileId: "s",
      state: "done",
    });
    expect(dbGetJob(db, "j1")?.createdAt).toBe(FIXED_EPOCH_MS);
  });
});

describe("stubSlicer and fakeTransport", () => {
  test("slice then print records every call", async () => {
    const ctx = testCtx();
    cleanups.push(ctx.cleanup);
    const slicer = stubSlicer();
    const transport = fakeTransport();
    const model = { path: join(ctx.workDir, "model.stl"), format: "stl" };
    const profile = { id: "stub/default", name: "Stub default", path: "/profiles/stub" };
    const gcode = await slicer.plugin.slice(model, profile, ctx);
    expect(readFileSync(gcode.path, "utf8")).toBe(STUB_GCODE);
    const target = { id: "p1", transportId: "fake", address: "10.0.0.2" };
    const handle = await transport.plugin.submit(gcode, target, ctx);
    const states: string[] = [];
    for await (const status of transport.plugin.status(handle)) states.push(status.state);
    await transport.plugin.cancel?.(handle);
    expect(slicer.calls).toHaveLength(1);
    expect(ctx.reports).toEqual([{ progress: 1, message: "sliced" }]);
    expect(transport.submissions.map((s) => s.handle.ref)).toEqual(["fake-1"]);
    expect(states).toEqual(["transferring", "printing", "done"]);
    expect(transport.canceled).toEqual([handle]);
  });

  test("a failing stub slicer throws a slicer StageError", async () => {
    const ctx = testCtx();
    cleanups.push(ctx.cleanup);
    const { plugin } = stubSlicer({ failWith: "no profile" });
    const profile = { id: "x", name: "x", path: "/x" };
    const slice = plugin.slice({ path: "/m.stl", format: "stl" }, profile, ctx);
    await expect(slice).rejects.toBeInstanceOf(StageError);
  });
});
