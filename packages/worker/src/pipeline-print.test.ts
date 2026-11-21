import { describe, expect, test } from "bun:test";
import { harness, never, states, waitForAbort } from "./pipeline-harness";

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
      status: async function* () {
        yield { state: "printing", progress: 0.2 };
        setTimeout(() => h.controller.abort(), 5);
        await never();
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(h.records[0].state).toBe("canceled");
  });

  test("the durable flag is polled mid-print when the pub/sub message is lost", async () => {
    let flag = false;
    const h = harness({
      cancelPollMs: 5,
      cancelRequested: async () => flag,
      status: async function* () {
        yield { state: "printing", progress: 0.3 };
        flag = true;
        await never();
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
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
