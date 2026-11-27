import { expect, test } from "bun:test";
import type { PrintStatus } from "@conveyor/shared";
import { memoryLocks } from "../test/helpers/memory-locks";
import { harness, waitForAbort } from "../test/helpers/pipeline-harness";
import { type PrinterLock, printerLock } from "./printer-lock";

async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(5);
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

test("a cancelled print is stopped before its printer lock is released, and stopped once", async () => {
  const order: string[] = [];
  const lock = recordingLock(order);
  let printing = false;
  const a = harness({
    status: async function* (_handle, signal) {
      yield { state: "printing", progress: 0.3 } satisfies PrintStatus;
      printing = true;
      if (signal) await waitForAbort(signal);
    },
    cancel: async () => {
      order.push("stop sent");
    },
    deps: () => ({ printerLock: lock }),
  });
  const b = harness({
    submit: async () => {
      order.push("next job submitted");
    },
    deps: () => ({ printerLock: lock }),
  });
  const first = a.run();
  await until(() => printing, "A never started printing");
  const second = b.run();
  a.controller.abort();
  expect(await first).toBe("canceled");
  expect(await second).toBe("done");
  expect(order).toEqual(["stop sent", "lock released", "next job submitted", "lock released"]);
  expect(a.cancels).toHaveLength(1);
});
