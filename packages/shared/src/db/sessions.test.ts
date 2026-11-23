import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SCHEMA_SQL } from "./schema.sql";
import { dbCreateSession, dbDeleteSession, dbSessionActive } from "./sessions";

function db(): Database {
  const handle = new Database(":memory:");
  handle.exec(SCHEMA_SQL);
  return handle;
}

describe("sessions", () => {
  test("a created session is active until it expires", () => {
    const handle = db();
    dbCreateSession(handle, "a", 100, 0);
    expect(dbSessionActive(handle, "a", 100)).toBe(true);
    expect(dbSessionActive(handle, "a", 101)).toBe(false);
    expect(dbSessionActive(handle, "b", 0)).toBe(false);
  });

  test("deleting a session revokes only that one", () => {
    const handle = db();
    dbCreateSession(handle, "a", 100, 0);
    dbCreateSession(handle, "b", 100, 0);
    dbDeleteSession(handle, "a");
    expect([dbSessionActive(handle, "a", 0), dbSessionActive(handle, "b", 0)]).toEqual([
      false,
      true,
    ]);
  });

  test("creating a session prunes the ones already expired", () => {
    const handle = db();
    dbCreateSession(handle, "old", 10, 0);
    dbCreateSession(handle, "new", 100, 50);
    const rows = handle.query<{ id: string }, []>("SELECT id FROM sessions ORDER BY id").all();
    expect(rows.map((row) => row.id)).toEqual(["new"]);
  });
});
