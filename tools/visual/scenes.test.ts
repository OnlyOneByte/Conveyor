import { expect, test } from "bun:test";
import { scenes, WIDTHS } from "./scenes.ts";

test("every scene is shot at one or more of the capture's widths", () => {
  expect(
    scenes.filter((s) => s.widths && !s.widths.some((w) => WIDTHS.includes(w))).map((s) => s.name),
  ).toEqual([]);
  expect(scenes.filter((s) => s.widths).map((s) => [s.name, s.widths])).toContainEqual([
    "belt-bar",
    [1440],
  ]);
});
