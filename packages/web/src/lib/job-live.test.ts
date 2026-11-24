import { describe, expect, test } from "bun:test";
import { pillText, printLine, stepIndex } from "./job-live.js";

describe("pillText", () => {
  test("names a waiting or modelling job without a percentage", () => {
    expect(pillText({ state: "queued" })).toBe("Waiting");
    expect(pillText({ state: "generating", progress: 0.5 })).toBe("Modelling");
  });

  test("adds the percentage while slicing, sending or printing", () => {
    expect(pillText({ state: "slicing", progress: 0.351 })).toBe("Slicing · 35%");
    expect(pillText({ state: "transferring", progress: 0.72 })).toBe("Sending · 72%");
    expect(pillText({ state: "printing" })).toBe("Printing · 0%");
  });

  test("uses the receipt's words once the job settles", () => {
    expect(pillText({ state: "done" })).toBe("Printed");
    expect(pillText({ state: "canceled" })).toBe("Canceled");
  });
});

describe("stepIndex", () => {
  test("puts each running state on its step, and a waiting job before the first", () => {
    expect(stepIndex("queued")).toBe(-1);
    expect(stepIndex("generating")).toBe(0);
    expect(stepIndex("printing")).toBe(3);
  });
});

describe("printLine", () => {
  const clock = (ms: number) => `t+${ms / 60000}m`;

  test("gives the layer, the time left and the finish time", () => {
    const print = { layer: 112, layers: 175, secondsLeft: 2280 };
    expect(printLine(print, 0, clock)).toBe("Layer 112 of 175 · 38 min left · done at t+38m");
  });

  test("leaves out whatever the printer doesn't report", () => {
    expect(printLine({ secondsLeft: 600 }, 0, clock)).toBe("10 min left · done at t+10m");
    expect(printLine({ layer: 3 }, 0, clock)).toBe("");
    expect(printLine(undefined, 0, clock)).toBe("");
  });
});
