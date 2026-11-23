import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrate } from "./migrate";
import { SCHEMA_SQL } from "./schema.sql";
import { dbCreateSession, dbDeleteSession, dbSessionPasswordVersion } from "./sessions";

function db(): Database {
  const handle = new Database(":memory:");
  handle.exec(SCHEMA_SQL);
  return handle;
}

const session = (id: string, expiresAt: number) => ({ id, expiresAt, passwordVersion: `v-${id}` });

describe("sessions", () => {
  test("a created session reports its password version until it expires", () => {
    const handle = db();
    dbCreateSession(handle, session("a", 100), 0);
    expect(dbSessionPasswordVersion(handle, "a", 100)).toBe("v-a");
    expect(dbSessionPasswordVersion(handle, "a", 101)).toBeNull();
    expect(dbSessionPasswordVersion(handle, "b", 0)).toBeNull();
  });

  test("deleting a session revokes only that one", () => {
    const handle = db();
    dbCreateSession(handle, session("a", 100), 0);
    dbCreateSession(handle, session("b", 100), 0);
    dbDeleteSession(handle, "a");
    expect([
      dbSessionPasswordVersion(handle, "a", 0),
      dbSessionPasswordVersion(handle, "b", 0),
    ]).toEqual([null, "v-b"]);
  });

  test("creating a session prunes the ones already expired", () => {
    const handle = db();
    dbCreateSession(handle, session("old", 10), 0);
    dbCreateSession(handle, session("new", 100), 50);
    const rows = handle.query<{ id: string }, []>("SELECT id FROM sessions ORDER BY id").all();
    expect(rows.map((row) => row.id)).toEqual(["new"]);
  });

  test("migrate adds the password version to a sessions table that lacks it", () => {
    const handle = db();
    handle.exec("DROP TABLE sessions");
    handle.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
    handle.exec("INSERT INTO sessions (id, expires_at) VALUES ('old', 100)");
    migrate(handle);
    expect(dbSessionPasswordVersion(handle, "old", 0)).toBe("");
    dbCreateSession(handle, session("new", 100), 0);
    expect(dbSessionPasswordVersion(handle, "new", 0)).toBe("v-new");
  });
});
