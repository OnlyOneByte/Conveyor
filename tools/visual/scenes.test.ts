import { expect, test } from "bun:test";
import { sceneFiles, scenes, WIDTHS } from "./scenes.ts";
import { runnerFor } from "./step.ts";

test("every scene is shot at one or more of the capture's widths", () => {
  expect(
    scenes.filter((s) => s.widths && !s.widths.some((w) => WIDTHS.includes(w))).map((s) => s.name),
  ).toEqual([]);
  expect(scenes.filter((s) => s.widths).map((s) => [s.name, s.widths])).toContainEqual([
    "belt-bar",
    [1440],
  ]);
});

test("scene files load in name order and every scene name is unique", () => {
  const files = sceneFiles.map((f) => f.file);
  expect(files).toEqual([...files].sort());
  expect(files.every((f) => /^\d{2}-[a-z-]+\.ts$/.test(f))).toBe(true);
  const names = scenes.map((s) => s.name);
  expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
});

test("every step of every scene has exactly one runner", () => {
  const steps = scenes.flatMap((s) => s.steps ?? []);
  expect(steps.length).toBeGreaterThan(0);
  for (const step of steps) expect(runnerFor(step).kind in step).toBe(true);
  const both = Object.assign({ wait: 1 }, { click: "x" });
  expect(() => runnerFor(both)).toThrow("no single step runner");
});
