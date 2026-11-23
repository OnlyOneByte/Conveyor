import { describe, expect, test } from "bun:test";
import type { PrintStatus } from "@conveyor/shared";
import { harness, never, states, waitForAbort } from "../test/helpers/pipeline-harness";

function withinMs<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`run did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

const closeRejects = (status: PrintStatus) => () => ({
  [Symbol.asyncIterator]: () => ({
    next: async (): Promise<IteratorResult<PrintStatus>> => ({ done: false, value: status }),
    return: async (): Promise<IteratorResult<PrintStatus>> => {
      throw new Error("socket reset");
    },
  }),
});

describe("runJob cancel while printing", () => {
  test("cancel while printing stops the printer and settles as canceled", async () => {
    const h = harness({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0].address).toBe("10.0.0.9");
    expect(states(h)).toEqual(["generating", "slicing", "transferring", "printing", "canceled"]);
    expect(h.records).toEqual([{ state: "canceled", reason: undefined }]);
  });

  test("a status stream that ignores the signal still stops the printer", async () => {
    const h = harness({
      streamCloseMs: 20,
      status: async function* () {
        yield { state: "printing", progress: 0.2 };
        setTimeout(() => h.controller.abort(), 5);
        await never();
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(h.records[0].state).toBe("canceled");
    expect(h.events.at(-1)?.message).toContain("did not close cleanly: timed out after 20 ms");
  });

  test("the durable flag is polled mid-print when the pub/sub message is lost", async () => {
    let flag = false;
    const h = harness({
      cancelPollMs: 5,
      cancelRequested: async () => flag,
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.3 };
        flag = true;
        if (signal) await waitForAbort(signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
  });

  test("a failing cancel-flag poll settles the job failed with the reason", async () => {
    let broken = false;
    const h = harness({
      cancelPollMs: 5,
      cancelRequested: async () => {
        if (broken) throw new Error("redis down");
        return false;
      },
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.3 };
        broken = true;
        if (signal) await waitForAbort(signal);
      },
    });
    await expect(withinMs(h.run(), 1000)).rejects.toThrow("cancel-flag poll failed: redis down");
    expect(h.records[0]).toEqual({
      state: "failed",
      reason: "cancel-flag poll failed: redis down",
    });
    expect(h.cancels).toHaveLength(0);
  }, 2000);

  test("a printer-reported done stays done when the stream close rejects", async () => {
    const h = harness({ status: closeRejects({ state: "done" }) });
    expect(await h.run()).toBe("done");
    expect(h.records[0].state).toBe("done");
    expect(h.events.at(-1)).toEqual({
      state: "done",
      message: "status stream did not close cleanly: socket reset",
      reason: undefined,
    });
  });

  test("a printer-reported failure keeps its reason and notes the stream close rejection", async () => {
    const h = harness({ status: closeRejects({ state: "failed", message: "thermal runaway" }) });
    await expect(h.run()).rejects.toThrow("thermal runaway");
    expect(h.records[0]).toEqual({
      state: "failed",
      reason: "thermal runaway",
      notes: "status stream did not close cleanly: socket reset",
    });
  });

  test("a print that reports done before the cancel is processed stays done", async () => {
    let flag = false;
    const h = harness({
      cancelRequested: async () => flag,
      status: async function* () {
        yield { state: "printing", progress: 0.99 };
        flag = true;
        yield { state: "done", progress: 1 };
      },
    });
    expect(await h.run()).toBe("done");
    expect(h.cancels).toHaveLength(0);
    expect(h.records[0].state).toBe("done");
  });
});

describe("runJob print outcomes", () => {
  test("a print canceled on the printer is recorded as canceled", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "printing", progress: 0.5 };
        yield { state: "canceled", message: "print cancelled on printer" };
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(0);
    expect(h.records[0].state).toBe("canceled");
  });

  test("a printer that rejects the stop is reported as failed, not canceled", async () => {
    const h = harness({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
      cancel: async () => {
        throw new Error("moonraker cancel failed: 503");
      },
    });
    await expect(h.run()).rejects.toThrow("did not confirm the stop");
    expect(states(h).at(-1)).toBe("failed");
    expect(h.records[0].state).toBe("failed");
    expect(h.records[0].reason).toContain("moonraker cancel failed: 503");
  });

  test("a status stream that ends without a terminal state is a lost connection", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "printing", progress: 0.4 };
      },
    });
    await expect(h.run()).rejects.toThrow("connection lost before completion");
    expect(h.records[0]).toEqual({ state: "failed", reason: "connection lost before completion" });
    expect(states(h)).not.toContain("done");
  });

  test("a real failure is still recorded as failed", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "failed", message: "thermal runaway" };
      },
    });
    await expect(h.run()).rejects.toThrow("thermal runaway");
    expect(h.records[0]).toEqual({ state: "failed", reason: "thermal runaway" });
  });
});

describe("runJob transport status contract", () => {
  test("a status outside the PrintStatus union fails the job naming the value", async () => {
    const paused: PrintStatus = JSON.parse('{"state":"paused"}');
    const h = harness({
      status: async function* () {
        yield paused;
      },
    });
    await expect(withinMs(h.run(), 1000)).rejects.toThrow('unhandled value: "paused"');
    expect(states(h).at(-1)).toBe("failed");
    expect(h.records).toEqual([{ state: "failed", reason: 'unhandled value: "paused"' }]);
  });
});
