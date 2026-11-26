import { expect, test } from "bun:test";
import { PrintMayHaveStartedError, PrintNotStartedError, type PrintStatus } from "@conveyor/shared";
import { memoryLocks } from "../test/helpers/memory-locks";
import { harness } from "../test/helpers/pipeline-harness";
import { type PrinterLock, printerLock, printerLockKey } from "./printer-lock";

function twoWorkersOnOnePrinter(lock: PrinterLock | undefined) {
  const started: string[] = [];
  const printer = { active: 0, most: 0, started };
  let finishFirst = () => {};
  const firstMayFinish = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const worker = (name: string) => {
    async function* status(): AsyncIterable<PrintStatus> {
      yield { state: "printing", progress: 0.5 };
      if (name === "a") await firstMayFinish;
      printer.active--;
      yield { state: "done" };
    }
    return harness({
      submit: async () => {
        printer.active++;
        printer.most = Math.max(printer.most, printer.active);
        printer.started.push(name);
      },
      status,
      deps: () => (lock ? { printerLock: lock } : {}),
    });
  };
  return { printer, finishFirst, a: worker("a"), b: worker("b") };
}

async function race(lock: PrinterLock | undefined) {
  const { printer, finishFirst, a, b } = twoWorkersOnOnePrinter(lock);
  const first = a.run();
  for (let tries = 0; tries < 200 && printer.started.length === 0; tries++) await Bun.sleep(5);
  const second = b.run();
  await Bun.sleep(60);
  const startedWhileFirstPrinted = [...printer.started];
  finishFirst();
  expect(await first).toBe("done");
  expect(await second).toBe("done");
  return { printer, startedWhileFirstPrinted };
}

test("two workers sending to one printer take turns: the second starts only after the first settles", async () => {
  const lock = printerLock(memoryLocks(), { held: () => null, log: () => {}, pollMs: 5 });
  const { printer, startedWhileFirstPrinted } = await race(lock);
  expect(startedWhileFirstPrinted).toEqual(["a"]);
  expect(printer.started).toEqual(["a", "b"]);
  expect(printer.most).toBe(1);
});

test("without the lock both workers start on the printer at once", async () => {
  const { printer, startedWhileFirstPrinted } = await race(undefined);
  expect(startedWhileFirstPrinted).toEqual(["a", "b"]);
  expect(printer.most).toBe(2);
});

test("a start that may have happened puts the printer on hold, and the next job is refused", async () => {
  const holds: { jobId: string; printerId: string; reason: string }[] = [];
  const lock = printerLock(memoryLocks(), {
    held: (printerId) => holds.find((hold) => hold.printerId === printerId)?.reason ?? null,
    log: () => {},
    pollMs: 5,
  });
  const deps = () => ({
    printerLock: lock,
    holdPrinter: (jobId: string, printerId: string, reason: string) =>
      void holds.push({ jobId, printerId, reason }),
  });
  const timedOut = harness({
    submit: async () => {
      throw new PrintMayHaveStartedError("moonraker gave no answer to print start within 30000 ms");
    },
    deps,
  });
  await expect(timedOut.run()).rejects.toThrow("moonraker gave no answer to print start");
  expect(holds).toEqual([
    {
      jobId: "job-1",
      printerId: "p1",
      reason: "moonraker gave no answer to print start within 30000 ms",
    },
  ]);
  const next = harness({ deps });
  await expect(next.run()).rejects.toThrow("printer is on hold");
  expect(next.submits).toBe(0);
  expect(next.records[0]?.reason).toBe(
    "printer is on hold: moonraker gave no answer to print start within 30000 ms",
  );
});

test("a job whose lock is lost mid-upload refuses at START, after another job took the printer", async () => {
  const store = memoryLocks();
  const lock = printerLock(store, { held: () => null, log: () => {}, pollMs: 5, ttlMs: 30 });
  const started: string[] = [];
  const b = harness({
    submit: async (ctx) => {
      await ctx.confirmStart?.();
      started.push("b");
    },
    deps: () => ({ printerLock: lock }),
  });
  let second: Promise<unknown> = Promise.resolve();
  const a = harness({
    submit: async (ctx) => {
      store.failRenewalsOf = store.held.get(printerLockKey("p1"));
      second = b.run();
      for (let tries = 0; tries < 400 && started.length === 0; tries++) await Bun.sleep(5);
      store.failRenewalsOf = undefined;
      await ctx.confirmStart?.();
      started.push("a");
    },
    deps: () => ({ printerLock: lock }),
  });
  await expect(a.run()).rejects.toBeInstanceOf(PrintNotStartedError);
  await second;
  expect(started).toEqual(["b"]);
  expect(a.cancels).toEqual([]);
});
