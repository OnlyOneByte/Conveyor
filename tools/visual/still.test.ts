import { expect, test } from "bun:test";
import { JUMP_MS, stillProblem } from "./still.ts";

test("a still check fails on any animation of 1 ms or more, on a selector that matches nothing, and on taking no samples", () => {
  expect(JUMP_MS).toBe(1);
  expect(stillProblem([[], [{ target: "div.slot", duration: 0.001 }], []])).toBeNull();
  expect(stillProblem([[], [], [{ target: "i.treads", duration: 1300 }]])).toBe(
    "i.treads animates for 1300 ms at sample 2 of 3",
  );
  expect(stillProblem([[{ target: "div.gone", duration: 1 }]])).toBe(
    "div.gone animates for 1 ms at sample 0 of 1",
  );
  expect(stillProblem([])).toBe("no samples were taken");
  expect(stillProblem([[], null, []])).toBe("the selector matches nothing at sample 1 of 3");
  expect(stillProblem([null, [{ target: "i.treads", duration: 1300 }]])).toBe(
    "the selector matches nothing at sample 0 of 2",
  );
});
