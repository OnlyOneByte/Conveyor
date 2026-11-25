import { describe, expect, test } from "bun:test";
import { functionBodies, withoutUnrunBodies } from "./bodies";

const MODULE = [
  "export const arrow = (n: number) => {",
  "  const doubled = n * 2;",
  "",
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
  "export function exhaustive(value: never): never {",
  "  throw new Error(String(value));",
  "}",
  "",
].join("\n");

const BUN_RUN = new Map([
  [1, 0],
  [2, 0],
  [4, 2],
  [7, 11],
  [8, 9],
  [11, 15],
  [12, 21],
  [13, 1],
  [16, 0],
  [17, 1],
]);

const corrected = withoutUnrunBodies(BUN_RUN, functionBodies("x.ts", MODULE));

describe("functionBodies", () => {
  test("finds each block body's header, first and last statement lines", () => {
    expect(functionBodies("x.ts", MODULE)).toEqual([
      { header: 1, first: 2, last: 4 },
      { header: 7, first: 8, last: 8 },
      { header: 11, first: 12, last: 13 },
      { header: 16, first: 17, last: 17 },
    ]);
  });

  test("starts a body at its first statement that runs, past a hoisted function", () => {
    const source = "function outer() {\n  function inner() {}\n  return 1;\n}\n";
    expect(functionBodies("x.ts", source)[0]).toEqual({ header: 1, first: 3, last: 3 });
  });
});

describe("withoutUnrunBodies", () => {
  test("an arrow function that never ran has its last line counted 0, not hit", () => {
    expect(BUN_RUN.get(4)).toBe(2);
    expect(corrected.get(4)).toBe(0);
    expect(corrected.get(2)).toBe(0);
  });

  test("a single-statement function whose header reads 0 counts its statement 0", () => {
    expect(BUN_RUN.get(17)).toBe(1);
    expect(corrected.get(17)).toBe(0);
  });

  test("a header reading 0 zeroes nothing when the body has several statements", () => {
    const source = "const f = () =>\n  {\n    run();\n    return 1;\n  };\n";
    const run = new Map([
      [1, 0],
      [3, 2],
      [4, 2],
    ]);
    expect(functionBodies("x.ts", source)).toEqual([{ header: 1, first: 3, last: 4 }]);
    expect(withoutUnrunBodies(run, functionBodies("x.ts", source))).toEqual(run);
  });

  test("a function that ran keeps every count bun gave it", () => {
    for (const line of [7, 8, 11, 12, 13]) expect(corrected.get(line)).toBe(BUN_RUN.get(line));
  });

  test("adds no line bun did not list, even inside a body it zeroes", () => {
    expect(corrected.has(3)).toBe(false);
    expect([...corrected.keys()]).toEqual([...BUN_RUN.keys()]);
  });

  test("a body whose first statement bun does not list keeps its counts", () => {
    const source = 'function strict() {\n  "use strict";\n  return 1;\n}\n';
    const run = new Map([
      [1, 3],
      [3, 3],
    ]);
    expect(withoutUnrunBodies(run, functionBodies("x.ts", source))).toEqual(run);
  });
});
