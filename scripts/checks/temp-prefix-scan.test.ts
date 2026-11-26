import { describe, expect, test } from "bun:test";
import { tempDirCalls } from "./temp-prefix-scan";

const prefixes = (source: string) => tempDirCalls(source).map((call) => call.prefix);

describe("tempDirCalls", () => {
  test.each([
    ['mkdtempSync(join(tmpdir(), "conveyor-a-"))', "conveyor-a-"],
    ["await mkdtemp(join(tmpdir(), 'vis-before-'))", "vis-before-"],
    ["mkdtempSync(join(tmpdir(), `pr-meta-`))", "pr-meta-"],
    ["mkdtempSync(join(tmpdir(), `conveyor-${name}-`))", "conveyor-"],
    ['fs.mkdtempSync(path.join(os.tmpdir(), "orca-smoke-"))', "orca-smoke-"],
    ['await mkdtemp(resolve(tmpdir(), "visual-x-"))', "visual-x-"],
  ])("reads the literal prefix of %s", (source, prefix) => {
    expect(prefixes(source)).toEqual([prefix]);
  });

  test.each([
    ["a template that starts with an expression", "mkdtempSync(join(tmpdir(), `${name}-x-`))"],
    ["a prefix held in a variable", "mkdtempSync(join(tmpdir(), PREFIX))"],
    ["a variable under os.tmpdir()", "mkdtempSync(path.join(os.tmpdir(), prefix))"],
    ["a prefix built by concatenation", 'mkdtempSync(join(tmpdir(), "conveyor-" + name))'],
    ["a path built from tmpdir() as text", "mkdtempSync(`${tmpdir()}/conveyor-`)"],
    ["more than one segment after tmpdir()", 'mkdtempSync(join(tmpdir(), "a", "conveyor-"))'],
    ["an empty prefix", 'mkdtempSync(join(tmpdir(), ""))'],
  ])("can't read %s, so it reports no prefix", (_name, source) => {
    expect(prefixes(source)).toEqual([null]);
  });

  test("ignores temp dirs made inside another dir, which only nest under a watched one", () => {
    expect(prefixes('mkdtempSync(join(scratch, "repo-"))')).toEqual([]);
    expect(prefixes("mkdtempSync(join(ROOT, PROBE_PREFIX))")).toEqual([]);
  });

  test("skips tempDirs' own mkdtemp, which checks its prefix against TEMP_PREFIXES at run time", () => {
    const own = "mkdtemp(join(tmpdir(), prefix))";
    expect(tempDirCalls(own, "packages/shared/test/helpers/temp.ts")).toEqual([]);
    expect(tempDirCalls(own, "packages/shared/test/helpers/other.ts")).toEqual([
      { line: 1, prefix: null },
    ]);
  });

  test("names the line of each call", () => {
    const source = 'const a = 1;\nconst b = mkdtempSync(join(tmpdir(), "conveyor-x-"));\n';
    expect(tempDirCalls(source)).toEqual([{ line: 2, prefix: "conveyor-x-" }]);
  });
});
