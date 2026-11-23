import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { enqueueJob } from "@conveyor/shared/queue";
import { type QueueWorker, type QueueWorkerOptions, startQueueWorker } from "../../src/loop";
import { buildDeps, type HarnessOptions, harness, req } from "../../src/pipeline-harness";

export let db: Database;
export let dir: string;
let workers: QueueWorker[] = [];
export const logs: string[] = [];
export const loggedAt: number[] = [];

export async function cleanup() {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
  logs.length = 0;
  loggedAt.length = 0;
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

export function setup(): void {
  dir = mkdtempSync(join(tmpdir(), "conveyor-worker-loop-"));
  db = openDb(join(dir, "conveyor.db"));
  for (const id of ["p1", "p2"]) {
    dbUpsertPrinter(db, { id, transportId: "tr", name: id, address: "10.0.0.9" });
  }
}

export function start(opts: HarnessOptions = {}, w: Partial<QueueWorkerOptions> = {}) {
  const h = harness(opts);
  const base = buildDeps(h, opts);
  const worker = startQueueWorker({
    db,
    owner: `w${workers.length + 1}`,
    concurrency: 2,
    dataDir: dir,
    base: {
      ...base,
      resolveJobTarget: (r) => {
        const target = base.resolveJobTarget(r);
        return target && { ...target, printerId: r.printerId };
      },
      log: (msg) => {
        logs.push(msg);
        loggedAt.push(Date.now());
      },
    },
    claimIdleMs: 10,
    tickMs: 10,
    renewEvery: 3,
    busyRetryMs: 10,
    busyMarginMs: 50,
    reapMs: 20,
    progressFlushMs: 10,
    ...w,
  });
  workers.push(worker);
  return { h, worker };
}

export const enqueue = (id: string, printerId = "p1") =>
  enqueueJob(db, { id, request: { ...req, printerId } });
export const row = (id: string) =>
  db.query<Record<string, unknown>, [string]>("SELECT * FROM jobs WHERE id = ?").get(id) ?? {};

export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${ms} ms`);
    await Bun.sleep(5);
  }
}
