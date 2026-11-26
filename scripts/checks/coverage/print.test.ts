import { describe, expect, test } from "bun:test";
import { printErrors, printSweepLog } from "./summary";

describe("printErrors", () => {
  const printed = (errors: string[], env: Record<string, string | undefined>) => {
    const lines: string[] = [];
    printErrors(errors, env, (text) => lines.push(text));
    return lines;
  };
  const error = "coverage sweep did not finish; no line map for unloaded files";

  test("under GitHub Actions each error also becomes one ::error:: annotation", () => {
    expect(printed([error], { GITHUB_ACTIONS: "true" })).toEqual([error, `::error::${error}`]);
  });

  test("outside GitHub Actions the output is the plain error, unchanged", () => {
    expect(printed([error], {})).toEqual([error]);
    expect(printed([error], { GITHUB_ACTIONS: "false" })).toEqual([error]);
    expect(printed([], { GITHUB_ACTIONS: "true" })).toEqual([]);
  });

  test("an annotation escapes newlines, carriage returns and percent signs", () => {
    expect(printed(["a\nb\r100%"], { GITHUB_ACTIONS: "true" })[1]).toBe("::error::a%0Ab%0D100%25");
  });
});

describe("printSweepLog", () => {
  const printed = (run: Parameters<typeof printSweepLog>[0]) => {
    const lines: string[] = [];
    printSweepLog(run, (text) => lines.push(text));
    return lines;
  };
  const reason = "sweep could not load packages/api/src/x.ts: Error: boom on import\n";

  test("prints why a file failed to import", () => {
    expect(printed({ completed: true, failed: ["packages/api/src/x.ts"], output: reason })).toEqual(
      [reason],
    );
  });

  test("prints the sweep's own output when it did not finish", () => {
    expect(printed({ completed: false, failed: [], output: "timed out" })).toEqual(["timed out"]);
  });

  test("prints nothing for a clean sweep, whatever it wrote", () => {
    expect(printed({ completed: true, failed: [], output: "1 pass\n" })).toEqual([]);
  });
});
