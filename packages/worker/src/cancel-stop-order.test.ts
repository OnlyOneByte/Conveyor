import { expect, test } from "bun:test";
import type { PrintStatus } from "@conveyor/shared";
import { memoryLocks } from "../test/helpers/memory-locks";
import { type HarnessOptions, harness, waitForAbort } from "../test/helpers/pipeline-harness";
import { type PrinterLock, printerLock } from "./printer-lock";
import { LeaseLostError } from "./run";

async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(5);
  }
}

async function within<T>(work: Promise<T>, what: string, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

function recordingLock(order: string[]): PrinterLock {
  const lock = printerLock(memoryLocks(), { held: () => null, log: () => {}, pollMs: 5 });
  return {
    async acquire(printerId, signal) {
      const held = await lock.acquire(printerId, signal);
      return {
        confirm: () => held.confirm(),
        release: async () => {
          order.push("lock released");
          await held.release();
        },
      };
    },
  };
}

function printingJob(lock: PrinterLock, extra: HarnessOptions = {}) {
  const seen = { printing: false };
  const job = harness({
    status: async function* (_handle, signal) {
      yield { state: "printing", progress: 0.3 } satisfies PrintStatus;
      seen.printing = true;
      if (signal) await waitForAbort(signal);
    },
    deps: () => ({ printerLock: lock }),
    ...extra,
  });
  return { job, seen };
}

const answeringStop = (order: string[]) => async () => {
  order.push("stop sent");
  await Bun.sleep(20);
  order.push("stop answered");
};

test("a canceled print's stop has answered before its printer lock is released, and is sent once", async () => {
  const order: string[] = [];
  const lock = recordingLock(order);
  const { job: a, seen } = printingJob(lock, { cancel: answeringStop(order) });
  const b = harness({
    submit: async () => {
      order.push("next job submitted");
    },
    deps: () => ({ printerLock: lock }),
  });
  const first = a.run();
  await until(() => seen.printing, "A never started printing");
  const second = b.run();
  a.controller.abort();
  expect(await first).toBe("canceled");
  expect(await second).toBe("done");
  expect(order).toEqual([
    "stop sent",
    "stop answered",
    "lock released",
    "next job submitted",
    "lock released",
  ]);
  expect(a.cancels).toHaveLength(1);
});

test("a lease lost mid-print sends no stop and still releases the lock", async () => {
  const order: string[] = [];
  const { job, seen } = printingJob(recordingLock(order), {
    cancel: answeringStop(order),
  });
  const run = job.run();
  await until(() => seen.printing, "the job never started printing");
  job.controller.abort(new LeaseLostError());
  await expect(run).rejects.toBeInstanceOf(LeaseLostError);
  expect(order).toEqual(["lock released"]);
  expect(job.cancels).toEqual([]);
});

test("a print that fails on the printer sends no stop and releases the lock", async () => {
  const order: string[] = [];
  const failing = harness({
    status: async function* () {
      yield { state: "printing", progress: 0.3 } satisfies PrintStatus;
      yield { state: "failed", message: "nozzle clog" } satisfies PrintStatus;
    },
    cancel: answeringStop(order),
    deps: () => ({ printerLock: recordingLock(order) }),
  });
  await expect(failing.run()).rejects.toThrow("nozzle clog");
  expect(failing.records.at(-1)?.state).toBe("failed");
  expect(order).toEqual(["lock released"]);
  expect(failing.cancels).toEqual([]);
});

test("a stop that never answers frees the lock after the bound and fails the job saying so", async () => {
  const order: string[] = [];
  const lock = recordingLock(order);
  let answer = () => {};
  const { job: a, seen } = printingJob(lock, {
    cancel: () => {
      order.push("stop sent");
      return new Promise<void>((resolve) => {
        answer = resolve;
      });
    },
    stopBoundMs: 50,
  });
  const b = harness({
    submit: async () => {
      order.push("next job submitted");
    },
    deps: () => ({ printerLock: lock }),
  });
  try {
    const first = a.run();
    await until(() => seen.printing, "A never started printing");
    const second = b.run();
    a.controller.abort();
    await expect(within(first, "the job never settled")).rejects.toThrow(
      "did not confirm the stop",
    );
    expect(a.records.at(-1)?.state).toBe("failed");
    expect(a.records.at(-1)?.reason).toContain(
      "cancel requested but the printer did not confirm the stop: no answer within 50 ms; check the printer",
    );
    expect(await second).toBe("done");
    expect(order).toEqual(["stop sent", "lock released", "next job submitted", "lock released"]);
  } finally {
    answer();
  }
});
