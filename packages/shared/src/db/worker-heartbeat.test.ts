import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { dbReadWorkerHeartbeat, dbWriteWorkerHeartbeat } from "./worker-heartbeat";

const meta = () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return db;
};

test("the last heartbeat written is the one read back", () => {
  const db = meta();
  expect(dbReadWorkerHeartbeat(db)).toBeNull();
  dbWriteWorkerHeartbeat(db, { at: 1, engines: { openscad: "ok" } });
  dbWriteWorkerHeartbeat(db, { at: 2, engines: { openscad: "missing", orca: "stub" } });
  expect(dbReadWorkerHeartbeat(db)).toEqual({
    at: 2,
    engines: { openscad: "missing", orca: "stub" },
  });
});

test.each(["not json", '{"at":"soon","engines":{}}', '{"at":1,"engines":{"orca":"maybe"}}'])(
  "a heartbeat row that doesn't parse (%s) reads as none",
  (value) => {
    const db = meta();
    db.prepare("INSERT INTO meta (key, value) VALUES ('worker_heartbeat', ?)").run(value);
    expect(dbReadWorkerHeartbeat(db)).toBeNull();
  },
);
