import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { dbReadWorkerHeartbeats } from "@conveyor/shared/db";
import { engineStates, startHeartbeat, workerId } from "./heartbeat";

const found = (present: string[]) => (bin: string) => (present.includes(bin) ? bin : null);

const meta = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
};

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

test("a worker is named by CONVEYOR_WORKER_ID, or else by its host name", () => {
  expect(workerId({ CONVEYOR_WORKER_ID: " printer-room " }, () => "abc123")).toBe("printer-room");
  expect(workerId({ CONVEYOR_WORKER_ID: " " }, () => "abc123")).toBe("abc123");
  expect(workerId({}, () => "abc123")).toBe("abc123");
});

test("the worker writes a heartbeat under its own name at start", () => {
  const db = meta();
  const env = { CONVEYOR_ENGINE_STUB: "1", CONVEYOR_WORKER_ID: "w1" };
  const stop = startHeartbeat(
    db,
    env,
    () => {},
    60_000,
    () => 1234,
  );
  expect(dbReadWorkerHeartbeats(db, 1234)).toEqual([
    { id: "w1", at: 1234, engines: { openscad: "stub", orca: "stub", prusa: "stub" } },
  ]);
  stop();
});

test("a worker that stops cleanly removes its own heartbeat, and only its own", () => {
  const db = meta();
  const other = startHeartbeat(
    db,
    { CONVEYOR_WORKER_ID: "w2" },
    () => {},
    60_000,
    () => 1,
  );
  const stop = startHeartbeat(
    db,
    { CONVEYOR_WORKER_ID: "w1" },
    () => {},
    60_000,
    () => 1,
  );
  stop();
  expect(dbReadWorkerHeartbeats(db, 1).map((beat) => beat.id)).toEqual(["w2"]);
  other();
});

test("every beat looks for the engines again, so a binary removed later shows as missing", async () => {
  const db = meta();
  let present = ["openscad", "orca-slicer"];
  let at = 1;
  const stop = startHeartbeat(
    db,
    { CONVEYOR_WORKER_ID: "w1" },
    () => {},
    5,
    () => at,
    (bin) => (present.includes(bin) ? bin : null),
  );
  expect(dbReadWorkerHeartbeats(db, 1)[0]?.engines.orca).toBe("ok");
  [present, at] = [["openscad"], 2];
  for (let tries = 0; tries < 200 && dbReadWorkerHeartbeats(db, 2)[0]?.at !== 2; tries++)
    await Bun.sleep(10);
  expect(dbReadWorkerHeartbeats(db, 2)[0]).toMatchObject({ at: 2, engines: { orca: "missing" } });
  stop();
});

test("a heartbeat that can't be written is logged, not thrown", () => {
  const db = new Database(":memory:");
  const logged: string[] = [];
  const stop = startHeartbeat(db, {}, (m) => logged.push(m), 60_000);
  stop();
  expect(logged).toEqual([
    expect.stringContaining("heartbeat not written: no such table: meta"),
    expect.stringContaining("heartbeat not cleared: no such table: meta"),
  ]);
});
