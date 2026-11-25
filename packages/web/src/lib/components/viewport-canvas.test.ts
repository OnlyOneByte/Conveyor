import { describe, expect, test } from "bun:test";
import { memoiseImport } from "./viewport-canvas.js";

describe("memoiseImport", () => {
  test("imports once and hands every caller the same promise", async () => {
    let calls = 0;
    const load = memoiseImport(async () => {
      calls++;
      return { default: "canvas" };
    });
    const first = load();
    const second = load();
    expect(second).toBe(first);
    expect(await first).toEqual({ default: "canvas" });
    expect(load()).toBe(first);
    expect(calls).toBe(1);
  });

  test("passes a failed import to its caller, then lets the next call try again", async () => {
    let calls = 0;
    const load = memoiseImport(async () => {
      calls++;
      if (calls === 1) throw new Error("chunk failed");
      return { default: "canvas" };
    });
    await expect(load()).rejects.toThrow("chunk failed");
    expect(await load()).toEqual({ default: "canvas" });
    expect(calls).toBe(2);
  });

  test("a failed early load nobody awaits raises no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const load = memoiseImport(() => Promise.reject(new Error("chunk failed")));
      void load();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
