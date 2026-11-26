import { describe, expect, test } from "bun:test";
import { REVIEWED, tempDirCalls, type Verdict } from "./temp-prefix-scan";

const verdicts = (source: string, file = "file.ts") =>
  tempDirCalls(source, file).map(({ line: _line, ...verdict }) => verdict);
const listed = (prefix: string): Verdict[] => [{ kind: "listed", prefix }];

describe("tempDirCalls reads a literal prefix directly under tmpdir()", () => {
  test.each([
    ['mkdtempSync(join(tmpdir(), "conveyor-a-"))', "conveyor-a-"],
    ["await mkdtemp(join(tmpdir(), 'vis-before-'))", "vis-before-"],
    ["mkdtempSync(join(tmpdir(), `pr-meta-`))", "pr-meta-"],
    [`mkdtempSync(join(tmpdir(), \`conveyor-\${name}-\`))`, "conveyor-"],
    ['fs.mkdtempSync(path.join(os.tmpdir(), "orca-smoke-"))', "orca-smoke-"],
    ['await fsp["mkdtemp"](resolve(tmpdir(), "visual-x-"))', "visual-x-"],
    [
      'import { mkdtempSync as mk } from "node:fs";\nimport { tmpdir as td } from "node:os";\nimport { join as j } from "node:path";\nmk(j(td(), "conveyor-alias-"));',
      "conveyor-alias-",
    ],
  ])("%s", (source, prefix) => {
    expect(verdicts(source)).toEqual(listed(prefix));
  });
});

describe("tempDirCalls fails closed on any other first argument", () => {
  test.each([
    ["a template that starts with an expression", `mkdtempSync(join(tmpdir(), \`\${name}-x-\`))`],
    ["a prefix held in a variable", "mkdtempSync(join(tmpdir(), PREFIX))"],
    ["a variable under os.tmpdir()", "mkdtempSync(path.join(os.tmpdir(), prefix))"],
    ["a prefix built by concatenation", 'mkdtempSync(join(tmpdir(), "conveyor-" + name))'],
    ["a path built from tmpdir() as text", `mkdtempSync(\`\${tmpdir()}/conveyor-\`)`],
    ["more than one segment after tmpdir()", 'mkdtempSync(join(tmpdir(), "a", "conveyor-"))'],
    ["an empty prefix", 'mkdtempSync(join(tmpdir(), ""))'],
    ["tmpdir() held in a const", 'const base = tmpdir();\nmkdtempSync(join(base, "conveyor-"));'],
    [
      "the joined path held in a const",
      'const at = join(tmpdir(), "conveyor-");\nmkdtempSync(at);',
    ],
    ["process.env.TMPDIR", 'mkdtempSync(join(process.env.TMPDIR ?? "", "conveyor-"))'],
    ["a literal /tmp path", 'mkdtempSync("/tmp/conveyor-")'],
    ["os.tmpdir read by element access", 'mkdtempSync(join(os["tmpdir"](), "conveyor-"))'],
    ["a renamed mkdtemp", 'import { mkdtemp as make } from "node:fs/promises";\nawait make(dir);'],
    [
      "a renamed tmpdir with a variable",
      'import { tmpdir as td } from "os";\nmkdtempSync(join(td(), p));',
    ],
    ["no argument at all", "mkdtempSync()"],
  ])("%s", (_name, source) => {
    expect(verdicts(source).map((verdict) => verdict.kind)).toEqual(["unreadable"]);
  });
});

describe("tempDirCalls refuses a prefix that can leave its parent dir", () => {
  test.each([
    'mkdtempSync(join(tmpdir(), "conveyor-/../../home/evil-"))',
    'mkdtempSync(join(tmpdir(), "conveyor-a/b-"))',
    'mkdtempSync(join(tmpdir(), "conveyor-a\\\\b-"))',
    'mkdtempSync(join(tmpdir(), "conveyor-..-"))',
    'const made = mkdtempSync(join(tmpdir(), "conveyor-x-"));\nmkdtempSync(join(made, "../../../x-"));',
  ])("%s", (source) => {
    expect(verdicts(source).map((verdict) => verdict.kind)).toContain("unreadable");
  });
});

describe("tempDirCalls fails on a mkdtemp name used other than as a direct call", () => {
  test.each([
    ["an alias", "const mk = fs.mkdtempSync;"],
    [".call", 'mkdtempSync.call(null, join(tmpdir(), "conveyor-x-"));'],
    ["promisify", "const mk = promisify(fs.mkdtemp);"],
    ["a re-export", 'export { mkdtempSync as makeTemp } from "node:fs";'],
    ["a require destructure", 'const { mkdtempSync: mk } = require("node:fs");'],
    ["the disposable variant", 'const mk = fsp["mkdtempDisposable"];'],
  ])("%s", (_name, source) => {
    expect(verdicts(source).map((verdict) => verdict.kind)).toContain("indirect");
  });

  test("an import of a mkdtemp name and a method named mkdtemp are not references", () => {
    const source =
      'import { mkdtemp as make } from "node:fs/promises";\nconst fake = { mkdtemp: () => "" };\nawait make(join(tmpdir(), "conveyor-x-"));';
    expect(verdicts(source)).toEqual(listed("conveyor-x-"));
  });
});

describe("tempDirCalls in other file types and nested dirs", () => {
  test.each(["file.mts", "file.cts", "file.js", "file.mjs", "file.cjs"])(
    "scans a %s the same way",
    (file) => {
      expect(verdicts("mkdtempSync(join(tmpdir(), name))", file)).toEqual([
        { kind: "unreadable", arg: "join(tmpdir(), name)" },
      ]);
    },
  );

  test("a dir made inside a dir the same file made under tmpdir() is accepted", () => {
    const source =
      'const scratch = mkdtempSync(join(tmpdir(), "conveyor-imports-"));\nconst root = mkdtempSync(join(scratch, "repo-"));';
    expect(verdicts(source)).toEqual([
      ...listed("conveyor-imports-"),
      { kind: "inside", parent: "scratch" },
    ]);
  });

  test("a dir made inside any other dir fails closed", () => {
    expect(verdicts('mkdtempSync(join(ROOT, "repo-"))')).toEqual([
      { kind: "unreadable", arg: 'join(ROOT, "repo-")' },
    ]);
  });

  test("only the reviewed calls are let through, in their own file", () => {
    for (const reviewed of REVIEWED) {
      const source = `mkdtempSync(${reviewed.arg})`;
      expect(verdicts(source, reviewed.file)).toEqual([]);
      expect(verdicts(source, "other.ts")).toEqual([{ kind: "unreadable", arg: reviewed.arg }]);
    }
  });

  test("names the line of each call", () => {
    const source = 'const a = 1;\nmkdtempSync(join(tmpdir(), "conveyor-x-"));\n';
    expect(tempDirCalls(source)).toEqual([{ kind: "listed", prefix: "conveyor-x-", line: 2 }]);
  });
});
