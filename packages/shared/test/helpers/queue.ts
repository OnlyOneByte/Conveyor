import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/index.ts";
import { enqueueJob, type QueueTiming } from "../../src/queue/lease.ts";
import { FIXED_EPOCH_MS } from "./clock.ts";

export interface QueueHarness {
  db: Database;
  path: string;
  timing: QueueTiming;
  advance(ms: number): void;
  enqueue(id: string, printerId?: string): void;
  row(id: string): Record<string, unknown>;
  set(id: string, columns: string): void;
  close(): void;
}

export function queueHarness(): QueueHarness {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-queue-"));
  const path = join(dir, "conveyor.db");
  const db = openDb(path);
  let clock = FIXED_EPOCH_MS;
  const timing: QueueTiming = { leaseMs: 30_000, backoffBaseMs: 5_000, now: () => clock };
  return {
    db,
    path,
    timing,
    advance: (ms) => {
      clock += ms;
    },
    enqueue: (id, printerId = "p1") =>
      enqueueJob(
        db,
        { id, request: { generator: { id: "gen" }, printerId, profileId: "prof" } },
        timing,
      ),
    row: (id) =>
      db.query<Record<string, unknown>, [string]>("SELECT * FROM jobs WHERE id = ?").get(id) ?? {},
    set: (id, columns) => db.query(`UPDATE jobs SET ${columns} WHERE id = ?`).run(id),
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function holdWriteLock(
  path: string,
  sqlWhileHeld = "SELECT 1",
): Promise<{ exited: Promise<number>; releasedAt: Promise<number> }> {
  const script = `const db = new (require("bun:sqlite").Database)(process.env.DB_FILE);
    db.exec("BEGIN IMMEDIATE"); console.log("locked"); Bun.sleepSync(300);
    db.exec(process.env.SQL_WHILE_HELD); console.log(Date.now()); db.exec("COMMIT");`;
  const holder = Bun.spawn([process.execPath, "-e", script], {
    env: { ...process.env, DB_FILE: path, SQL_WHILE_HELD: sqlWhileHeld },
    stdout: "pipe",
  });
  const reader = holder.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("locked\n")) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`lock holder exited before locking: ${seen}`);
    seen += decoder.decode(value);
  }
  const releasedAt = (async () => {
    for (;;) {
      const line = seen.split("\n")[1];
      if (line && /^\d+$/.test(line)) return Number(line);
      const { done, value } = await reader.read();
      if (done) throw new Error(`lock holder exited without a release time: ${seen}`);
      seen += decoder.decode(value);
    }
  })();
  return { exited: holder.exited, releasedAt };
}
