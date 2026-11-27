import { expect, test } from "bun:test";
import {
  filesToPrune,
  PrintMayHaveStartedError,
  PrintNotStartedError,
  type PrintStatus,
} from "@conveyor/shared";
import { memoryLocks } from "../test/helpers/memory-locks";
import { harness } from "../test/helpers/pipeline-harness";
import { PRINTER_LOCK_TTL_MS, type PrinterLock, printerLock, printerLockKey } from "./printer-lock";

async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(5);
  }
}

function lockOnAClock() {
  const clock = { now: 0 };
  const now = () => clock.now;
  const store = memoryLocks(now);
  const lock = printerLock(store, { held: () => null, log: () => {}, pollMs: 5, now });
  const expire = () => {
    clock.now += PRINTER_LOCK_TTL_MS;
  };
  return { store, lock, expire };
}

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

async function race(lock: PrinterLock | undefined, secondArrived: () => boolean) {
  const { printer, finishFirst, a, b } = twoWorkersOnOnePrinter(lock);
  const first = a.run();
  await until(() => printer.started.length > 0, "A never started");
  const second = b.run();
  await until(() => secondArrived() || printer.started.length > 1, "B never reached the printer");
  const startedWhileFirstPrinted = [...printer.started];
  finishFirst();
  expect(await first).toBe("done");
  expect(await second).toBe("done");
  return { printer, startedWhileFirstPrinted };
}

test("two workers sending to one printer take turns: the second starts only after the first settles", async () => {
  const logs: string[] = [];
  const lock = printerLock(memoryLocks(), {
    held: () => null,
    log: (line) => logs.push(line),
    pollMs: 5,
  });
  const waiting = () => logs.includes("printer p1 is busy with another job; waiting for it");
  const { printer, startedWhileFirstPrinted } = await race(lock, waiting);
  expect(startedWhileFirstPrinted).toEqual(["a"]);
  expect(printer.started).toEqual(["a", "b"]);
  expect(printer.most).toBe(1);
});

test("without the lock both workers start on the printer at once", async () => {
  const { printer, startedWhileFirstPrinted } = await race(undefined, () => false);
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
  const { lock, expire } = lockOnAClock();
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
      expire();
      second = b.run();
      await until(() => started.length > 0, "B never started");
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

function printerFiles() {
  const files = new Set(["conveyor-old.gcode"]);
  const pruned: string[] = [];
  const pruneFiles = async (_target: unknown, keep: ReadonlySet<string>) => {
    const doomed = filesToPrune([...files], keep, undefined);
    for (const name of doomed) files.delete(name);
    pruned.push(...doomed);
    return doomed;
  };
  return { files, pruned, pruneFiles };
}

test("a job whose lock is lost mid-upload never removes the file the next job uploaded", async () => {
  const { lock, expire } = lockOnAClock();
  const printer = printerFiles();
  const startedWith: boolean[] = [];
  let bUploaded = false;
  let aSettled = () => {};
  const aHasSettled = new Promise<void>((resolve) => {
    aSettled = resolve;
  });
  const b = harness({
    submit: async (ctx) => {
      printer.files.add("conveyor-b.gcode");
      bUploaded = true;
      await aHasSettled;
      await ctx.confirmStart?.();
      startedWith.push(printer.files.has("conveyor-b.gcode"));
    },
    pruneFiles: printer.pruneFiles,
    deps: () => ({ printerLock: lock, printerFilesToKeep: () => ["conveyor-b.gcode"] }),
  });
  let second: Promise<unknown> = Promise.resolve();
  const a = harness({
    submit: async (ctx) => {
      printer.files.add("conveyor-a.gcode");
      expire();
      second = b.run();
      await until(() => bUploaded, "B never started");
      await ctx.confirmStart?.();
    },
    pruneFiles: printer.pruneFiles,
    deps: () => ({ printerLock: lock, printerFilesToKeep: () => ["conveyor-a.gcode"] }),
  });
  await expect(a.run()).rejects.toBeInstanceOf(PrintNotStartedError);
  aSettled();
  expect(await second).toBe("done");
  expect(bUploaded).toBe(true);
  expect(startedWith).toEqual([true]);
  expect(printer.files.has("conveyor-b.gcode")).toBe(true);
});

test("a job whose lock is lost mid-print leaves the printer's files alone", async () => {
  const { store, lock } = lockOnAClock();
  const printer = printerFiles();
  const logs: string[] = [];
  const h = harness({
    status: async function* () {
      yield { state: "printing", progress: 0.5 };
      store.failRenewalsOf = store.held.get(printerLockKey("p1"));
      yield { state: "done" };
    },
    pruneFiles: printer.pruneFiles,
    deps: () => ({
      printerLock: lock,
      printerFilesToKeep: () => [],
      log: (line: string) => logs.push(line),
    }),
  });
  expect(await h.run()).toBe("done");
  expect(printer.pruned).toEqual([]);
  expect(logs).toContain(
    "job job-1: the printer lock was lost, so old files on the printer were left alone",
  );
});
