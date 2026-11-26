import { describe, expect, test } from "bun:test";
import { requestCancel } from "@conveyor/shared/queue";
import { memoryLocks } from "../test/helpers/memory-locks";
import { cleanup, db, queued, row } from "../test/helpers/queue-deps-harness";
import { pause, printerLock } from "./printer-lock";
import { JobCanceledError } from "./run";

const LONG_MS = 60_000;
const PROMPT_MS = 100;

const elapsed = async (work: Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await work;
  return performance.now() - start;
};

describe("pause", () => {
  test("returns at once when the signal is already aborted", async () => {
    const stop = new AbortController();
    stop.abort();
    expect(await elapsed(pause(LONG_MS, stop.signal))).toBeLessThan(PROMPT_MS);
  });

  test("ends as soon as the signal aborts mid-wait", async () => {
    const stop = new AbortController();
    const waiting = pause(LONG_MS, stop.signal);
    await Bun.sleep(20);
    stop.abort();
    expect(await elapsed(waiting)).toBeLessThan(PROMPT_MS);
  });
});

describe("a cancel during a wait lands at once, not after a full interval", () => {
  test("the Redis printer-lock wait", async () => {
    const lock = printerLock(memoryLocks(), { held: () => null, log: () => {}, pollMs: LONG_MS });
    const first = await lock.acquire("p1", new AbortController().signal);
    const cancel = new AbortController();
    const waiting = lock.acquire("p1", cancel.signal).catch((err: unknown) => err);
    await Bun.sleep(20);
    cancel.abort();
    expect(await elapsed(waiting)).toBeLessThan(PROMPT_MS);
    expect(await waiting).toBeInstanceOf(JobCanceledError);
    await first.release();
  });

  test("the SQLite printer-slot wait", async () => {
    let waitingAtSlot: () => void = () => {};
    const atSlot = new Promise<void>((resolve) => {
      waitingAtSlot = resolve;
    });
    const h = queued(
      {
        generate: async () => {
          db.query(
            "INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, created_at, updated_at) VALUES ('other', 'gen', 'p1', 'prof', 'printing', 0, 0)",
          ).run();
        },
        slice: async () => {
          setTimeout(waitingAtSlot, 20);
        },
      },
      {},
      LONG_MS,
    );
    try {
      const run = h.run();
      await atSlot;
      requestCancel(db, "job-1");
      h.controller.abort();
      expect(await elapsed(run)).toBeLessThan(PROMPT_MS);
      expect(await run).toBe("canceled");
      expect(row().state).toBe("canceled");
    } finally {
      cleanup();
    }
  });
});
