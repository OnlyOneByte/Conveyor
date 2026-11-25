import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { sqliteFinishedBefore, sqliteLive, sqliteRetentionState } from "./retention";

const dir = mkdtempSync(join(tmpdir(), "conveyor-retention-db-"));
const db = openDb(join(dir, "conveyor.db"));
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function row(state: string, updatedAt: number, params: unknown = {}): string {
  const id = randomUUID();
  db.query(
    "INSERT INTO jobs (id, generator_id, params_json, state, created_at, updated_at) VALUES (?, 'passthrough', ?, ?, ?, ?)",
  ).run(id, JSON.stringify(params), state, updatedAt, updatedAt);
  return id;
}

test("finished means a terminal row last updated before the cutoff", () => {
  const old = ["done", "failed", "canceled"].map((state) => row(state, 1_000));
  const recent = row("done", 5_000);
  const running = row("printing", 1_000);
  const found = sqliteFinishedBefore(db, 2_000);
  for (const id of old) expect(found).toContain(id);
  expect(found).not.toContain(recent);
  expect(found).not.toContain(running);
});

test("live jobs and the uploads they use come from every non-terminal row", () => {
  const upload = randomUUID();
  const queued = row("queued", 1_000, { uploadId: upload, filename: "a.stl" });
  const done = row("done", 1_000, { uploadId: randomUUID() });
  const broken = randomUUID();
  db.query(
    "INSERT INTO jobs (id, generator_id, params_json, state, created_at, updated_at) VALUES (?, 'passthrough', '{oops', 'slicing', 1, 1)",
  ).run(broken);
  const live = sqliteLive(db);
  expect(live.ids.has(queued)).toBe(true);
  expect(live.ids.has(broken)).toBe(true);
  expect(live.ids.has(done)).toBe(false);
  expect([...live.uploads]).toEqual([upload]);
});

test("the retention clock is kept in the meta table across restarts", () => {
  expect(sqliteRetentionState(db).read()).toEqual({ startedAt: undefined, lastRunAt: undefined });
  sqliteRetentionState(db).write({ startedAt: 1_000, lastRunAt: 2_000 });
  expect(sqliteRetentionState(db).read()).toEqual({ startedAt: 1_000, lastRunAt: 2_000 });
});
