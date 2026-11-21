import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import {
  claimJob,
  DEFAULT_TIMING,
  enqueueJob,
  markSubmitted,
  releaseLease,
  requestCancel,
  takePrinterSlot,
} from "@conveyor/shared/queue";
import { type QueueWorker, type QueueWorkerOptions, startQueueWorker } from "./loop";
import { buildDeps, type HarnessOptions, harness, req, waitForAbort } from "./pipeline-harness";

let db: Database;
let dir: string;
let workers: QueueWorker[] = [];
const logs: string[] = [];

afterEach(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  workers = [];
  logs.length = 0;
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup(): void {
  dir = mkdtempSync(join(tmpdir(), "conveyor-worker-loop-"));
  db = openDb(join(dir, "conveyor.db"));
  for (const id of ["p1", "p2"]) {
    dbUpsertPrinter(db, { id, transportId: "tr", name: id, address: "10.0.0.9" });
  }
}

function start(opts: HarnessOptions = {}, w: Partial<QueueWorkerOptions> = {}) {
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
      log: (msg) => logs.push(msg),
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

const enqueue = (id: string, printerId = "p1") =>
  enqueueJob(db, { id, request: { ...req, printerId } });
const row = (id: string) =>
  db.query<Record<string, unknown>, [string]>("SELECT * FROM jobs WHERE id = ?").get(id) ?? {};

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${ms} ms`);
    await Bun.sleep(5);
  }
}

describe("the sqlite queue worker", () => {
  test("caps engine work, and a job waiting at the printer slot does not count", async () => {
    setup();
    db.query(
      `INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, lease_owner, lease_until, created_at, updated_at)
       VALUES ('busy', 'gen', 'p1', 'prof', 'printing', 'other', ?, 0, 0)`,
    ).run(Date.now() + 20_000);
    enqueue("a", "p1");
    enqueue("b", "p2");
    let active = 0;
    let most = 0;
    start(
      {
        generate: async () => {
          most = Math.max(most, ++active);
          await Bun.sleep(30);
          active--;
        },
      },
      { concurrency: 1 },
    );
    await until(() => row("b").state === "done");
    expect(row("a")).toMatchObject({ state: "slicing", submit_started_at: null });
    expect(most).toBe(1);
    db.query("UPDATE jobs SET state = 'done' WHERE id = 'busy'").run();
    await until(() => row("a").state === "done");
  });

  test("reaps a job whose worker died and runs it again", async () => {
    setup();
    enqueue("a");
    claimJob(db, "dead");
    db.query("UPDATE jobs SET lease_until = 0 WHERE id = 'a'").run();
    start({}, { timing: { ...DEFAULT_TIMING, backoffBaseMs: 0 } });
    await until(() => row("a").state === "done");
    expect(row("a").attempts).toBe(2);
  });

  test("resumes a job already on the printer without submitting it again", async () => {
    setup();
    enqueue("a");
    const lease = claimJob(db, "gone")?.lease;
    if (!lease) throw new Error("not claimed");
    db.query("UPDATE jobs SET state = 'slicing' WHERE id = 'a'").run();
    takePrinterSlot(db, lease);
    markSubmitted(db, lease, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
    releaseLease(db, lease);
    const { h } = start();
    await until(() => row("a").state === "done");
    expect(h.submits).toBe(0);
  });

  test("a cancel during a long engine run ends it within a tick", async () => {
    setup();
    enqueue("a");
    let running = false;
    start({
      generate: (ctx) => {
        running = true;
        return waitForAbort(ctx.signal);
      },
    });
    await until(() => running);
    requestCancel(db, "a");
    await until(() => row("a").state === "canceled");
  });

  test("renews the lease through a stage longer than the lease", async () => {
    setup();
    enqueue("a");
    start({ generate: () => Bun.sleep(600) }, { timing: { ...DEFAULT_TIMING, leaseMs: 200 } });
    await until(() => row("a").state === "done");
    expect(row("a").attempts).toBe(1);
  });

  test("retries a renewal that meets SQLITE_BUSY until the lock is released", async () => {
    setup();
    db.exec("PRAGMA busy_timeout = 0");
    enqueue("a");
    const holder = new Database(join(dir, "conveyor.db"));
    start(
      {
        generate: async () => {
          holder.exec("BEGIN IMMEDIATE");
          await Bun.sleep(150);
          holder.exec("COMMIT");
          await Bun.sleep(100);
        },
      },
      { timing: { ...DEFAULT_TIMING, leaseMs: 400 } },
    );
    await until(() => row("a").state === "done");
    holder.close();
    expect(row("a").attempts).toBe(1);
  });

  test("gives up a renewal still busy close to the lease's end", async () => {
    setup();
    db.exec("PRAGMA busy_timeout = 0");
    enqueue("a");
    const holder = new Database(join(dir, "conveyor.db"));
    const { h } = start(
      {
        generate: async (ctx) => {
          holder.exec("BEGIN IMMEDIATE");
          await waitForAbort(ctx.signal).catch(() => {});
          holder.exec("COMMIT");
        },
      },
      { timing: { ...DEFAULT_TIMING, leaseMs: 150 } },
    );
    await until(() => logs.some((l) => l.includes("lease renewal failed")));
    holder.close();
    expect(h.submits).toBe(0);
  });
});

describe("stopping the sqlite queue worker", () => {
  test("requeues a job that has not reached the printer, without counting the attempt", async () => {
    setup();
    enqueue("a");
    const { worker } = start({ generate: (ctx) => waitForAbort(ctx.signal) });
    await until(() => row("a").state === "generating");
    await worker.stop();
    expect(row("a")).toMatchObject({
      state: "queued",
      attempts: 0,
      lease_owner: null,
      cancel_requested_at: null,
    });
  });

  test("lets a submit in progress finish and write the marker, then releases it", async () => {
    setup();
    enqueue("a");
    let finish = () => {};
    const { h, worker } = start({
      submit: (ctx) =>
        new Promise<void>((resolve, reject) => {
          finish = resolve;
          ctx.signal.addEventListener("abort", () => reject(new Error("submit aborted")));
        }),
    });
    await until(() => h.submits === 1);
    const stopped = worker.stop();
    await Bun.sleep(30);
    expect(row("a").lease_owner).not.toBeNull();
    finish();
    await stopped;
    expect(row("a")).toMatchObject({ state: "transferring", lease_owner: null });
    expect(row("a").submitted_at).not.toBeNull();
    expect(h.cancels).toHaveLength(0);
  });

  test("releases a printing job untouched, and the next worker resumes it", async () => {
    setup();
    enqueue("a");
    const first = start({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.2 };
        if (signal) await waitForAbort(signal);
      },
    });
    await until(() => row("a").state === "printing");
    await first.worker.stop();
    expect(row("a")).toMatchObject({ state: "printing", lease_owner: null });
    expect(first.h.cancels).toHaveLength(0);
    const second = start();
    await until(() => row("a").state === "done");
    expect(first.h.submits + second.h.submits).toBe(1);
  });
});
