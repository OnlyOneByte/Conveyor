import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_TIMING } from "@conveyor/shared/queue";
import {
  cleanup,
  db,
  dir,
  enqueue,
  logs,
  row,
  setup,
  start,
  until,
} from "../test/helpers/loop-harness";
import { waitForAbort } from "../test/helpers/pipeline-harness";

afterEach(cleanup);

describe("the sqlite queue worker", () => {
  test("renews the lease through a stage longer than the lease", async () => {
    setup();
    enqueue("a");
    start({ generate: () => Bun.sleep(1200) }, { timing: { ...DEFAULT_TIMING, leaseMs: 1000 } });
    await until(() => row("a").state === "done", 10_000);
    expect(row("a").attempts).toBe(1);
  }, 15_000);

  test("retries a renewal that meets SQLITE_BUSY until the lock is released", async () => {
    setup();
    db.exec("PRAGMA busy_timeout = 0");
    enqueue("a");
    const holder = new Database(join(dir, "conveyor.db"));
    let clockReads = 0;
    const now = () => {
      clockReads++;
      return Date.now();
    };
    let firstUntil = 0;
    start(
      {
        generate: async () => {
          firstUntil = Number(row("a").lease_until);
          holder.exec("BEGIN IMMEDIATE");
          const before = clockReads;
          await until(() => clockReads > before || Date.now() > firstUntil, 10_000);
          holder.exec("COMMIT");
          await until(() => Date.now() > firstUntil + 100, 10_000);
        },
      },
      { timing: { ...DEFAULT_TIMING, leaseMs: 2000, now }, renewEvery: 100 },
    );
    await until(() => row("a").state === "done", 10_000);
    holder.close();
    expect(row("a").attempts).toBe(1);
  }, 15_000);

  test("gives up a renewal still busy once its next retry would land inside the margin", async () => {
    setup();
    db.exec("PRAGMA busy_timeout = 0");
    enqueue("a");
    const holder = new Database(join(dir, "conveyor.db"));
    let clock = Date.now();
    let reads = 0;
    const now = () => {
      reads++;
      return clock;
    };
    let locked = false;
    const { h } = start(
      {
        generate: async (ctx) => {
          holder.exec("BEGIN IMMEDIATE");
          locked = true;
          await expect(waitForAbort(ctx.signal)).rejects.toBeDefined();
          holder.exec("COMMIT");
        },
      },
      { timing: { ...DEFAULT_TIMING, leaseMs: 400, now }, busyMarginMs: 150, busyRetryMs: 10 },
    );
    const gaveUp = () => logs.some((l) => l.includes("lease renewal failed"));
    await until(() => locked);
    const leaseUntil = Number(row("a").lease_until);
    clock = leaseUntil - 160;
    const atEdge = reads;
    await until(() => reads > atEdge + 10);
    expect(gaveUp()).toBe(false);
    clock = leaseUntil - 159;
    await until(gaveUp);
    expect(Number(row("a").lease_until)).toBe(leaseUntil);
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
