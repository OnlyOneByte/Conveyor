import { describe, expect, test } from "bun:test";
import { functionBodies, withoutUnrunBodies } from "./bodies";

const MODULE = [
  "export const arrow = (n: number) => {",
  "  const doubled = n * 2;",
  "  return doubled + 1;",
  "};",
  "",
  "export function called() {",
  "  return 0;",
  "}",
  "",
  "export function cmp(a: number, b: number) {",
  "  if (a > b) return 1;",
  "  return -1;",
  "}",
  "",
].join("\n");

const BUN_RUN = new Map([
  [1, 0],
  [2, 0],
  [3, 2],
  [6, 11],
  [7, 9],
  [10, 15],
  [11, 21],
  [12, 1],
]);

describe("functionBodies", () => {
  test("finds each block body's first and last statement lines", () => {
    expect(functionBodies("x.ts", MODULE)).toEqual([
      { first: 2, last: 3 },
      { first: 7, last: 7 },
      { first: 11, last: 12 },
    ]);
  });

  test("starts a body at its first statement that runs, past a hoisted function", () => {
    const source = "function outer() {\n  function inner() {}\n  return 1;\n}\n";
    expect(functionBodies("x.ts", source)[0]).toEqual({ first: 3, last: 3 });
  });
});

describe("withoutUnrunBodies", () => {
  const corrected = withoutUnrunBodies(BUN_RUN, functionBodies("x.ts", MODULE));

  test("an arrow function that never ran has its last line counted 0, not hit", () => {
    expect(BUN_RUN.get(3)).toBe(2);
    expect(corrected.get(3)).toBe(0);
    expect(corrected.get(2)).toBe(0);
  });

  test("a function that ran keeps every count bun gave it", () => {
    for (const line of [6, 7, 10, 11, 12]) expect(corrected.get(line)).toBe(BUN_RUN.get(line));
  });

  test("adds no line bun did not list", () => {
    expect([...corrected.keys()]).toEqual([...BUN_RUN.keys()]);
  });
});
