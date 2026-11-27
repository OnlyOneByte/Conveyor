import { expect, test } from "bun:test";
import { DelayedError } from "bullmq";
import { type HeldJob, type HoldWaitDeps, waitOutHold } from "./hold-wait";

function fakeJob(id: string, timestamp: number, printerId: string, log: string[]): HeldJob {
  return {
    id,
    timestamp,
    data: { printerId },
    promote: async () => {
      log.push(`promote ${id}`);
    },
    moveToDelayed: async (until: number) => {
      log.push(`delay ${id} ${until > Date.now() + 1000 ? "later" : "now"}`);
    },
  };
}

function deps(delayed: HeldJob[], over: Partial<HoldWaitDeps> = {}): HoldWaitDeps {
  return {
    held: () => null,
    canceled: async () => false,
    settleCanceled: async () => {},
    shownAs: async () => undefined,
    showQueued: async () => {},
    delayed: async () => delayed,
    printerOf: (job) => String(Reflect.get(Object(job.data), "printerId")),
    ...over,
  };
}

test("a job claimed after the release lets the older waiting jobs for its printer go first, oldest first", async () => {
  const log: string[] = [];
  const oldest = fakeJob("a", 100, "p1", log);
  const older = fakeJob("b", 200, "p1", log);
  const otherPrinter = fakeJob("x", 50, "p2", log);
  const newer = fakeJob("d", 400, "p1", log);
  const claimed = fakeJob("c", 300, "p1", log);
  const waiting = deps([newer, older, otherPrinter, oldest]);
  await expect(waitOutHold(claimed, "t", "p1", waiting)).rejects.toBeInstanceOf(DelayedError);
  expect(log).toEqual(["promote a", "promote b", "delay c now"]);
});

test("a job with no older job waiting runs", async () => {
  const log: string[] = [];
  const claimed = fakeJob("a", 100, "p1", log);
  const later = fakeJob("b", 200, "p1", log);
  expect(await waitOutHold(claimed, "t", "p1", deps([later]))).toBe("run");
  expect(log).toEqual([]);
});

test("a held job is shown queued once, then waits again without publishing", async () => {
  const log: string[] = [];
  const shown: string[] = [];
  const claimed = fakeJob("a", 100, "p1", log);
  let current: { state: "queued"; message: string } | undefined;
  const held = deps([], {
    held: () => "may have started",
    shownAs: async () => current,
    showQueued: async (_id, message) => {
      shown.push(message);
      current = { state: "queued", message };
    },
  });
  await expect(waitOutHold(claimed, "t", "p1", held)).rejects.toBeInstanceOf(DelayedError);
  await expect(waitOutHold(claimed, "t", "p1", held)).rejects.toBeInstanceOf(DelayedError);
  expect(shown).toEqual(["waiting: the printer is on hold (may have started)"]);
  expect(log).toEqual(["delay a later", "delay a later"]);
});

test("a canceled job settles instead of waiting again", async () => {
  const log: string[] = [];
  const settled: string[] = [];
  const claimed = fakeJob("a", 100, "p1", log);
  const held = deps([], {
    held: () => "may have started",
    canceled: async () => true,
    settleCanceled: async (id) => {
      settled.push(id);
    },
  });
  expect(await waitOutHold(claimed, "t", "p1", held)).toBe("canceled");
  expect(settled).toEqual(["a"]);
  expect(log).toEqual([]);
});
