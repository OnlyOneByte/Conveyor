import { expect, test } from "bun:test";
import { holdProblem, MAX_SHIFT_PX, SETTLE_MS, settleProblem } from "./holds.ts";

const held = (top: number) => ({ present: true, top });

test("a hold passes only while the element stays and the anchor stays within a few px of where the scroll put it", () => {
  expect(MAX_SHIFT_PX).toBe(4);
  expect(holdProblem([held(86), held(87), held(82)], 86)).toBeNull();
  expect(holdProblem([held(86), { present: false, top: 86 }, held(86)], 86)).toBe(
    "gone at sample 1 of 3",
  );
  expect(holdProblem([held(86), held(156)], 86)).toBe("the anchor moved 70 px");
  expect(holdProblem([held(86), { present: true, top: null }], 86)).toBe("the anchor is missing");
  expect(holdProblem([held(86)], null)).toBe("the anchor is missing");
  expect(holdProblem([], 86)).toBe("no samples were taken");
});

test("a hold waits for its element after the scroll, and says where the page ended up if it never came", () => {
  expect(SETTLE_MS).toBe(2000);
  expect(settleProblem({ present: true, scrollY: 42, room: 285 })).toBeNull();
  expect(settleProblem({ present: false, scrollY: 37.6, room: 37.6 })).toBe(
    "never appeared within 2000 ms; the page scrolled to 38 px of 38 px of room",
  );
});
