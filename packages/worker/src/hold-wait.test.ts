import { expect, test } from "bun:test";
import { DelayedError } from "bullmq";
import { type HeldJob, type HoldWaitDeps, waitOutHold } from "./hold-wait";

function fakeJob(
  id: string,
  timestamp: number,
  printerId: string,
  log: string[],
  promoted: { error?: Error; state?: "delayed" | "waiting" } = {},
): HeldJob {
  return {
    id,
    timestamp,
    data: { printerId },
    getState: async () => promoted.state ?? "delayed",
    promote: async () => {
      if (promoted.error) throw promoted.error;
      log.push(`promote ${id}`);
    },
    moveToDelayed: async (until: number, token?: string) => {
      log.push(`delay ${id} ${until > Date.now() + 1000 ? "later" : "now"} with ${token}`);
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
  await expect(waitOutHold(claimed, "lock-c", "p1", waiting)).rejects.toBeInstanceOf(DelayedError);
  expect(log).toEqual(["promote a", "promote b", "delay c now with lock-c"]);
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
  await expect(waitOutHold(claimed, "lock-1", "p1", held)).rejects.toBeInstanceOf(DelayedError);
  await expect(waitOutHold(claimed, "lock-2", "p1", held)).rejects.toBeInstanceOf(DelayedError);
  expect(shown).toEqual(["waiting: the printer is on hold (may have started)"]);
  expect(log).toEqual(["delay a later with lock-1", "delay a later with lock-2"]);
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

const lost = (id: string) => new Error(`Job ${id} is not in the delayed state. promote`);

test("an older job another worker already promoted is left alone, and the rest still go first", async () => {
  const log: string[] = [];
  const taken = fakeJob("a", 100, "p1", log, { error: lost("a"), state: "waiting" });
  const older = fakeJob("b", 200, "p1", log);
  const claimed = fakeJob("c", 300, "p1", log);
  const waiting = deps([taken, older]);
  await expect(waitOutHold(claimed, "lock-c", "p1", waiting)).rejects.toBeInstanceOf(DelayedError);
  expect(log).toEqual(["promote b", "delay c now with lock-c"]);
});

test("a promote that fails while the job is still delayed is not ignored", async () => {
  const log: string[] = [];
  const broken = new Error("Connection is closed.");
  const stuck = fakeJob("a", 100, "p1", log, { error: broken, state: "delayed" });
  const claimed = fakeJob("c", 300, "p1", log);
  await expect(waitOutHold(claimed, "lock-c", "p1", deps([stuck]))).rejects.toBe(broken);
  expect(log).toEqual([]);
});
