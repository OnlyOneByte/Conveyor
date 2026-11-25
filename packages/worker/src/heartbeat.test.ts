import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { dbReadWorkerHeartbeat } from "@conveyor/shared/db";
import { engineStates, startHeartbeat } from "./heartbeat";

const found = (present: string[]) => (bin: string) => (present.includes(bin) ? bin : null);

test("each engine is ok when its binary is found, by its env path or its default name", () => {
  const env = { OPENSCAD_BIN: "/opt/openscad/bin/openscad", ORCA_BIN: "/opt/orca/AppRun" };
  expect(engineStates(env, found(["/opt/openscad/bin/openscad", "prusa-slicer"]))).toEqual({
    openscad: "ok",
    orca: "missing",
    prusa: "ok",
  });
});

test("stub mode reports every engine as a stub without looking for binaries", () => {
  expect(engineStates({ CONVEYOR_ENGINE_STUB: "1" }, found([]))).toEqual({
    openscad: "stub",
    orca: "stub",
    prusa: "stub",
  });
});

test("the worker writes a heartbeat at start with its engines", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const stop = startHeartbeat(
    db,
    { CONVEYOR_ENGINE_STUB: "1" },
    () => {},
    60_000,
    () => 1234,
  );
  stop();
  expect(dbReadWorkerHeartbeat(db)).toEqual({
    at: 1234,
    engines: { openscad: "stub", orca: "stub", prusa: "stub" },
  });
});

test("a heartbeat that can't be written is logged, not thrown", () => {
  const db = new Database(":memory:");
  const logged: string[] = [];
  const stop = startHeartbeat(db, {}, (m) => logged.push(m), 60_000);
  stop();
  expect(logged).toEqual([expect.stringContaining("heartbeat not written: no such table: meta")]);
});
