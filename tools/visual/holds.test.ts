import { expect, test } from "bun:test";
import { holdProblem, MAX_SHIFT_PX } from "./holds.ts";

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
});
