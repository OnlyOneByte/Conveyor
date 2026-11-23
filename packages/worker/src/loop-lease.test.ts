import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_TIMING } from "@conveyor/shared/queue";
import {
  cleanup,
  db,
  dir,
  enqueue,
  loggedAt,
  logs,
  row,
  setup,
  start,
  until,
} from "./loop-harness";
import { waitForAbort } from "./pipeline-harness";

afterEach(cleanup);

describe("the sqlite queue worker", () => {
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
      { timing: { ...DEFAULT_TIMING, leaseMs: 400 }, busyMarginMs: 150 },
    );
    await until(() => logs.some((l) => l.includes("lease renewal failed")));
    const gaveUpAt = loggedAt[logs.findIndex((l) => l.includes("lease renewal failed"))] ?? 0;
    expect(gaveUpAt).toBeLessThan(Number(row("a").lease_until) - 75);
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
