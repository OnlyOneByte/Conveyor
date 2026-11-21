import { describe, expect, test } from "bun:test";
import { PrintNotStartedError } from "@conveyor/shared";
import { harness, states, waitForAbort } from "./pipeline-harness";

describe("runJob cancel before printing", () => {
  test("a durable cancel flag set before start skips every stage", async () => {
    const h = harness({ cancelRequested: async () => true });
    expect(await h.run()).toBe("canceled");
    expect(h.generated).toBe(0);
    expect(states(h)).toEqual(["canceled"]);
    expect(h.records[0].state).toBe("canceled");
  });

  test("a durable cancel flag seen between stages stops the job", async () => {
    let flag = false;
    const h = harness({
      generate: async () => {
        flag = true;
      },
      cancelRequested: async () => flag,
    });
    expect(await h.run()).toBe("canceled");
    expect(states(h)).toEqual(["generating", "canceled"]);
  });

  test("cancel during slicing aborts the slice and never reaches the printer", async () => {
    let sliceSignal: AbortSignal | undefined;
    const h = harness({
      slice: (ctx) => {
        sliceSignal = ctx.signal;
        setTimeout(() => h.controller.abort(), 5);
        return waitForAbort(ctx.signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(sliceSignal?.aborted).toBe(true);
    expect(h.submits).toBe(0);
    expect(h.cancels).toHaveLength(0);
    expect(states(h)).toEqual(["generating", "slicing", "canceled"]);
  });

  test("an uncanceled job completes as done", async () => {
    const h = harness();
    expect(await h.run()).toBe("done");
    expect(states(h).at(-1)).toBe("done");
  });
});

describe("runJob cancel during submit", () => {
  test("cancel during submit waits for the start, then stops that print", async () => {
    const h = harness({
      submit: async () => {
        h.controller.abort();
        await new Promise((r) => setTimeout(r, 5));
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.order).toEqual(["started", "stopped"]);
    expect(h.cancels[0].ref).toBe("model.gcode");
  });

  test("a flag set during submit is seen before printing starts", async () => {
    let flag = false;
    const h = harness({
      submit: async () => {
        flag = true;
      },
      cancelRequested: async () => flag,
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(states(h)).not.toContain("done");
  });

  test("an interrupted submit stops the printer through the transport's own handle", async () => {
    const h = harness({
      submit: async () => {
        h.controller.abort();
        throw new Error("start request aborted");
      },
      handleFor: (target, ref) => ({
        transportId: "tr",
        printerId: target.id,
        ref,
        address: target.address,
        deviceId: target.secrets?.mainboardId,
      }),
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(1);
    expect(h.cancels[0].deviceId).toBe("mainboard-abc");
    expect(h.cancels[0].ref).toBe("model.gcode");
  });

  test("a cancel during upload that never started the print sends no stop", async () => {
    const h = harness({
      submit: async () => {
        h.controller.abort();
        throw new PrintNotStartedError("canceled before print start");
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.cancels).toHaveLength(0);
    expect(h.order).toEqual([]);
  });

  test("an interrupted submit whose stop fails settles failed with the reason", async () => {
    const h = harness({
      submit: async () => {
        h.controller.abort();
        throw new Error("start request aborted");
      },
      cancel: async () => {
        throw new Error("elegoo cmd 130 timed out");
      },
    });
    await expect(h.run()).rejects.toThrow("did not confirm the stop");
    expect(h.records[0].state).toBe("failed");
    expect(h.records[0].reason).toContain("elegoo cmd 130 timed out");
  });
});
