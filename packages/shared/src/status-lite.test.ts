import { describe, expect, test } from "bun:test";
import { parseStatusEvent as full } from "./status";
import { parseStatusEvent as lite } from "./status-lite";

const base = { jobId: "j1", state: "printing", at: 1 };

const valid: Record<string, unknown> = {
  "the minimum": base,
  "every field": {
    ...base,
    seq: 4,
    stage: "transport",
    progress: 0.42,
    message: "printing",
    error: { stage: "slicer", reason: "boom" },
    timings: [
      { stage: "generator", enteredAt: 1, durationMs: 2 },
      { stage: "slicer", enteredAt: 3 },
    ],
    print: { layer: 0, layers: 120, secondsLeft: 61.5 },
    bytesSent: 0,
    bytesTotal: 1024,
  },
  "a null stage": { ...base, stage: null },
  "an empty print": { ...base, print: {} },
  "empty timings": { ...base, timings: [] },
  "unknown keys, which are dropped": { ...base, extra: true, print: { layer: 1, other: 2 } },
  "a float seq and a negative progress": { ...base, seq: 1.5, progress: -1 },
  "every state": { ...base, state: "canceled" },
};

const invalid: Record<string, unknown> = {
  "a missing jobId": { state: "done", at: 1 },
  "a numeric jobId": { ...base, jobId: 7 },
  "an unknown state": { ...base, state: "exploded" },
  "a missing at": { jobId: "j1", state: "done" },
  "a string at": { ...base, at: "1" },
  "an unknown stage": { ...base, stage: "painter" },
  "a string progress": { ...base, progress: "42%" },
  "a numeric message": { ...base, message: 3 },
  "an error without a reason": { ...base, error: { stage: "slicer" } },
  "a null error": { ...base, error: null },
  "timings that are not a list": { ...base, timings: {} },
  "a timing without enteredAt": { ...base, timings: [{ stage: "slicer" }] },
  "a timing with an unknown stage": { ...base, timings: [{ stage: "x", enteredAt: 1 }] },
  "a fractional layer": { ...base, print: { layer: 1.5 } },
  "a negative layer": { ...base, print: { layer: -1 } },
  "zero layers": { ...base, print: { layers: 0 } },
  "negative seconds left": { ...base, print: { secondsLeft: -1 } },
  "a null print": { ...base, print: null },
  "a negative byte count": { ...base, bytesSent: -1 },
  "a fractional byte count": { ...base, bytesTotal: 1.5 },
  "a list": [base],
  "a number": 3,
  null: null,
};

describe("the Zod-free status parser agrees with the Zod one", () => {
  test.each(Object.entries(valid))("accepts %s the same way", (_name, event) => {
    const raw = JSON.stringify(event);
    expect(full(raw)).toBeDefined();
    expect(lite(raw)).toEqual(full(raw));
  });

  test.each(Object.entries(invalid))("rejects %s", (_name, event) => {
    const raw = JSON.stringify(event);
    expect(full(raw)).toBeUndefined();
    expect(lite(raw)).toBeUndefined();
  });

  test.each([
    ["not json", "{"],
    ["empty", ""],
    ["missing", null],
  ])("rejects %s input", (_name, raw) => {
    expect(full(raw)).toBeUndefined();
    expect(lite(raw)).toBeUndefined();
  });
});
