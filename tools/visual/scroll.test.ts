import { describe, expect, test } from "bun:test";
import { describeMotion, type Position } from "./scroll.ts";

const at = (top: number, scrollY = 0, connected = true): Position => ({
  top,
  left: 16,
  height: 20,
  scrollY,
  connected,
});

describe("describeMotion", () => {
  test("says when no animation frame ran", () => {
    expect(describeMotion([])).toBe("no animation frame ran in 1 s");
  });

  test("reports a target that held still", () => {
    expect(describeMotion([at(500), at(500), at(500)])).toBe(
      "3 frames, 1 positions, top 500, left 16, height 20, scrollY 0",
    );
  });

  test("reports how far a moving target travelled and whether the page scrolled", () => {
    expect(describeMotion([at(500, 0), at(512.4, 4), at(530, 9)])).toBe(
      "3 frames, 3 positions, top 500..530, left 16, height 20, scrollY 0..9",
    );
  });

  test("flags a target that left the document", () => {
    expect(describeMotion([at(500), at(500, 0, false)])).toContain(", detached");
  });
});
