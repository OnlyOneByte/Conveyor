import { describe, expect, test } from "bun:test";
import { type Poll, printWatch, STANDBY_ENDED, STANDBY_POLLS } from "./watch.ts";

const polls = (...list: Poll[]) => {
  const watch = printWatch();
  const steps = [];
  for (const poll of list) {
    const step = watch(poll);
    steps.push(step);
    if (step.final) break;
  }
  return steps;
};

const standby = (n: number, progress = 0): Poll[] =>
  Array.from({ length: n }, () => ({ state: "standby", progress }));

describe("printWatch", () => {
  test("a print that goes back to standby without an ending ends failed after the bound", () => {
    const steps = polls({ state: "printing", progress: 0.4 }, ...standby(STANDBY_POLLS + 5));
    expect(steps).toHaveLength(1 + STANDBY_POLLS);
    expect(steps.at(-1)).toEqual({
      status: { state: "failed", message: STANDBY_ENDED },
      final: true,
    });
    expect(steps.slice(1, -1).every((step) => !step.final && !step.status)).toBe(true);
  });

  test("a cancelled or complete within the bound still wins", () => {
    const cancelled = polls({ state: "printing", progress: 0.4 }, ...standby(STANDBY_POLLS - 1), {
      state: "cancelled",
      progress: 0,
    });
    expect(cancelled.at(-1)?.status?.state).toBe("canceled");
    const done = polls({ state: "printing", progress: 0.4 }, ...standby(1, 1));
    expect(done.at(-1)).toEqual({ status: { state: "done", progress: 1 }, final: true });
  });

  test("a printing or paused poll between standby polls starts the count again", () => {
    const steps = polls(
      { state: "printing", progress: 0.4 },
      ...standby(STANDBY_POLLS - 1),
      { state: "paused", progress: 0.5 },
      ...standby(STANDBY_POLLS - 1),
      { state: "complete", progress: 1 },
    );
    expect(steps.at(-1)?.status?.state).toBe("done");
  });

  test("standby before the print starts is waited on, however long", () => {
    const steps = polls(...standby(STANDBY_POLLS * 4), { state: "printing", progress: 0.1 });
    expect(steps.every((step) => !step.final)).toBe(true);
    expect(steps.at(-1)?.status?.state).toBe("printing");
  });
});
