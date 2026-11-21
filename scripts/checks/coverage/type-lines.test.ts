import { describe, expect, test } from "bun:test";
import { mergeCoverage, nonBlankLines, summarize } from "./summary";
import { typeOnlyLines } from "./type-lines";

const lines = (source: string) => [...typeOnlyLines("packages/shared/src/x.ts", source)].sort();

const INLINE = [
  "export function record(",
  "  db: string,",
  "  job: {",
  "    id: string;",
  "    name: string;",
  "  },",
  "): string {",
  "  return db + job.id;",
  "}",
  "",
].join("\n");

const NAMED = [
  "export interface Job {",
  "  id: string;",
  "  name: string;",
  "}",
  "",
  "export function record(",
  "  db: string,",
  "  job: Job,",
  "): string {",
  "  return db + job.id;",
  "}",
  "",
].join("\n");

describe("typeOnlyLines", () => {
  test("drops the body of an inline parameter type but keeps the parameter and the code", () => {
    expect(lines(INLINE)).toEqual([4, 5, 6]);
  });

  test("drops every line of an interface and a multi-line type alias", () => {
    expect(lines(NAMED)).toEqual([1, 2, 3, 4]);
    expect(lines("type Pair = {\n  a: number;\n  b: string;\n};\n")).toEqual([1, 2, 3, 4]);
  });

  test("keeps a line that mixes a type with any real token", () => {
    expect(lines("const x: { a: number } = { a: 1 };\n")).toEqual([]);
    expect(lines("export const pick = (x: {\n  a: number;\n}): number => x.a;\n")).toEqual([2]);
  });

  test("keeps value object literals and default values even when they look like types", () => {
    const source = "export const config = {\n  a: 1,\n  b: [2],\n};\n";
    expect(lines(source)).toEqual([]);
    expect(lines("export function f(\n  n: number = 3,\n): number {\n  return n;\n}\n")).toEqual(
      [],
    );
  });

  test("keeps every heritage clause line, since a class's extends expression runs", () => {
    const source = [
      "export class A extends",
      "  Base",
      "  implements",
      "    Shape",
      "{",
      "  size = 1;",
      "}",
      "",
    ].join("\n");
    expect(lines(source)).toEqual([]);
  });

  test("keeps enums, which emit code", () => {
    expect(lines("export enum Kind {\n  A,\n  B,\n}\n")).toEqual([]);
  });
});

describe("the ratchet ignores how a type is written", () => {
  const found = (source: string) => {
    const path = "packages/shared/src/x.ts";
    const merged = mergeCoverage({
      sources: [path],
      measured: new Map(),
      sweep: new Map([[path, nonBlankLines(source)]]),
      fallback: () => new Map(),
      typeLines: () => typeOnlyLines(path, source),
    });
    return summarize(merged.coverage).shared.found;
  };

  test("the same function with an inline type and with an interface has the same found count", () => {
    expect(found(INLINE)).toBe(6);
    expect(found(NAMED)).toBe(6);
  });

  test("a hit on a dropped type line does not count toward coverage", () => {
    const path = "packages/shared/src/x.ts";
    const merged = mergeCoverage({
      sources: [path],
      measured: new Map([[path, new Map([[4, 1]])]]),
      sweep: new Map([[path, nonBlankLines(INLINE)]]),
      fallback: () => new Map(),
      typeLines: () => typeOnlyLines(path, INLINE),
    });
    expect(summarize(merged.coverage).shared).toEqual({ found: 6, hit: 0 });
  });
});
