import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  dbReadWorkerHeartbeats,
  dbWriteWorkerHeartbeat,
  WORKER_FORGET_MS,
} from "./worker-heartbeat";

const meta = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
};

test("each worker keeps its own heartbeat; a second worker doesn't hide the first", () => {
  const db = meta();
  expect(dbReadWorkerHeartbeats(db, 10)).toEqual([]);
  dbWriteWorkerHeartbeat(db, "a", { at: 1, engines: { openscad: "ok" } });
  dbWriteWorkerHeartbeat(db, "b", { at: 5, engines: { orca: "stub" } });
  dbWriteWorkerHeartbeat(db, "a", { at: 2, engines: { openscad: "missing" } });
  expect(dbReadWorkerHeartbeats(db, 10)).toEqual([
    { id: "a", at: 2, engines: { openscad: "missing" } },
    { id: "b", at: 5, engines: { orca: "stub" } },
  ]);
});

test("a worker silent for over a day is forgotten, and pruned when another one beats", () => {
  const db = meta();
  const now = 10 * WORKER_FORGET_MS;
  dbWriteWorkerHeartbeat(db, "gone", { at: now - WORKER_FORGET_MS - 1, engines: {} });
  dbWriteWorkerHeartbeat(db, "kept", { at: now - WORKER_FORGET_MS, engines: {} });
  expect(dbReadWorkerHeartbeats(db, now).map((beat) => beat.id)).toEqual(["kept"]);
  dbWriteWorkerHeartbeat(db, "here", { at: now, engines: {} });
  const keys = db.query<{ key: string }, []>("SELECT key FROM meta ORDER BY key").all();
  expect(keys.map((row) => row.key)).toEqual(["worker_heartbeat:here", "worker_heartbeat:kept"]);
});

test("the single heartbeat from before per-worker beats is dropped on the first new beat", () => {
  const db = meta();
  db.prepare("INSERT INTO meta (key, value) VALUES ('worker_heartbeat', ?)").run(
    JSON.stringify({ at: 1, engines: {} }),
  );
  db.prepare("INSERT INTO meta (key, value) VALUES ('worker_heartbeats_note', 'x')").run();
  expect(dbReadWorkerHeartbeats(db, 2)).toEqual([]);
  dbWriteWorkerHeartbeat(db, "a", { at: 2, engines: {} });
  const keys = db.query<{ key: string }, []>("SELECT key FROM meta ORDER BY key").all();
  expect(keys.map((row) => row.key)).toEqual(["worker_heartbeat:a", "worker_heartbeats_note"]);
});

test.each(["not json", '{"at":"soon","engines":{}}', '{"at":1,"engines":{"orca":"maybe"}}'])(
  "a heartbeat row that doesn't parse (%s) is skipped",
  (value) => {
    const db = meta();
    db.prepare("INSERT INTO meta (key, value) VALUES ('worker_heartbeat:x', ?)").run(value);
    dbWriteWorkerHeartbeat(db, "y", { at: 1, engines: {} });
    expect(dbReadWorkerHeartbeats(db, 1).map((beat) => beat.id)).toEqual(["y"]);
  },
);
