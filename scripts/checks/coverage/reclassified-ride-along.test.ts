import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { commit, sh } from "../test-repo";
import {
  type FileChange,
  type MoveFacts,
  type Reclassification,
  reclassificationFloors,
} from "./reclassified";
import { changesSince } from "./runner";

const FROM = "packages/worker/src/pipeline-harness.ts";
const TO = "packages/worker/test/helpers/pipeline-harness.ts";
const USER = "packages/worker/src/pipeline.test.ts";
const RUN = "packages/worker/src/run.ts";
const EMPTY = "packages/worker/src/empty.ts";
const GONE = "packages/worker/src/gone.ts";
const MOVE: Reclassification = { package: "worker", from: FROM, to: TO, floor: 82.34 };

const change = (overrides: Partial<FileChange>): FileChange => ({
  from: USER,
  to: USER,
  renamed: false,
  opaque: false,
  removed: ['import { harness } from "./pipeline-harness";'],
  added: ['import { harness } from "../test/helpers/pipeline-harness";'],
  ...overrides,
});

const MOVED = change({
  from: FROM,
  to: TO,
  renamed: true,
  removed: ['import { runJob } from "./pipeline";'],
  added: ['import { runJob } from "../../src/pipeline";'],
});

const lexical = (files: string[]) => (specifier: string, from: string) => {
  const path = `${posix.normalize(posix.join(posix.dirname(from), specifier))}.ts`;
  return files.includes(path) ? path : null;
};

const PIPELINE = "packages/worker/src/pipeline.ts";

const facts = (changes: FileChange[] | null): MoveFacts => ({
  renamed: (from, to) => from === FROM && to === TO,
  changes,
  resolveAtBase: lexical([FROM, PIPELINE, "packages/worker/src/x.ts"]),
  resolveAtHead: lexical([TO, PIPELINE, "packages/worker/src/x.ts"]),
  baseLines: () => 130,
  current: {
    api: { hit: 1, found: 1 },
    worker: { hit: 788, found: 957 },
    shared: { hit: 1, found: 1 },
    plugins: { hit: 1, found: 1 },
    web: { hit: 1, found: 1 },
  },
  base: { worker: 83.99 },
  committed: { worker: 82.34 },
});

const run = (changes: FileChange[] | null) => reclassificationFloors([MOVE], [], facts(changes));

describe("a recorded move carries nothing else in its package", () => {
  test("allows the rename and import paths that follow it, in any order", () => {
    const multiLine = change({
      removed: ['} from "./pipeline-harness";'],
      added: ['} from "../test/helpers/pipeline-harness";'],
    });
    const sorted = change({
      removed: [
        'import { a } from "./pipeline-harness";',
        'import type { B } from "./pipeline-harness";',
      ],
      added: [
        'import type { B } from "../test/helpers/pipeline-harness";',
        'import { a } from "../test/helpers/pipeline-harness";',
      ],
    });
    const result = run([MOVED, change({}), multiLine, sorted]);
    expect(result.errors).toEqual([]);
    expect(result.floors).toEqual({ worker: 82.34 });
  });

  test.each([
    ["a new file", change({ from: null, to: "packages/worker/src/new.ts", removed: [] })],
    ["a deleted file", change({ to: null, added: [] })],
    [
      "a code line",
      change({
        added: ['import { harness } from "../test/helpers/pipeline-harness";', "const y = 1;"],
      }),
    ],
    [
      "an import that changes names",
      change({ added: ['import { other } from "../test/helpers/pipeline-harness";'] }),
    ],
    [
      "an import pointed somewhere other than the move",
      change({ added: ['import { harness } from "./x";'] }),
    ],
    [
      "an extra import line",
      change({
        added: [
          'import { harness } from "../test/helpers/pipeline-harness";',
          'import { x } from "../test/helpers/pipeline-harness";',
        ],
      }),
    ],
    [
      "another import pointed at the moved file",
      change({
        removed: ['import { x } from "./x";'],
        added: ['import { x } from "../test/helpers/pipeline-harness";'],
      }),
    ],
    [
      "an edit between two paths that do not resolve",
      change({ removed: ['import { x } from "./gone";'], added: ['import { x } from "./lost";'] }),
    ],
    ["an import that does not resolve", change({ added: ['import { harness } from "./gone";'] })],
    [
      "an edit to an import the move did not touch",
      change({ removed: ['import { x } from "./x";'], added: ['import { x } from "./pipeline";'] }),
    ],
    [
      "the moved file's import pointed elsewhere",
      { ...MOVED, added: ['import { runJob } from "../../src/x";'] },
    ],
    ["an import removed", change({ added: [] })],
    ["a mode or binary change", change({ removed: [], added: [], opaque: true })],
    ["a path git quoted", change({ from: '"packages/worker/a\\tb.ts"', to: '"x"' })],
    ["another rename", change({ to: "packages/worker/src/other.ts", renamed: true })],
    ["a code line in the moved file", { ...MOVED, added: [...MOVED.added, "export const z = 2;"] }],
  ])("refuses %s", (_case, extra) => {
    const changes = extra.renamed && extra.from === FROM ? [extra] : [MOVED, extra];
    const result = run(changes);
    expect(result.floors).toEqual({});
    expect(result.errors.join("\n")).toContain(
      "changes beside a recorded move; only the move, import paths that follow it, coverage baselines and Markdown may",
    );
  });

  test("allows the coverage baselines and Markdown beside the move", () => {
    const at = (path: string) => change({ from: path, to: path, removed: [], added: ["x"] });
    const result = run([
      MOVED,
      at("scripts/checks/coverage/baseline/worker.json"),
      at("scripts/checks/coverage/baseline/reclassified.json"),
      at("docs/contributing.md"),
      at("packages/worker/README.md"),
    ]);
    expect(result.errors).toEqual([]);
  });

  test.each([
    "bunfig.toml",
    "package.json",
    "tsconfig.json",
    "scripts/checks/coverage/main.ts",
    ".github/workflows/ci.yml",
    "packages/api/src/x.ts",
    "packages/worker/tsconfig.json",
    "plugins/printer/x/index.ts",
  ])("refuses a change to %s beside the move", (path) => {
    const outside = change({ from: path, to: path, removed: [], added: ['  "x",'] });
    const result = run([MOVED, outside]);
    expect(result.floors).toEqual({});
    expect(result.errors).toEqual([
      `scripts/checks/coverage/baseline/reclassified.json: ${path} changes beside a recorded move; only the move, import paths that follow it, coverage baselines and Markdown may`,
    ]);
  });

  test("refuses the move when the PR's changes cannot be read", () => {
    expect(run(null).errors).toEqual([
      "scripts/checks/coverage/baseline/reclassified.json: could not read this PR's changes",
    ]);
  });
});

const scratch = mkdtempSync(join(tmpdir(), "conveyor-ride-along-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("changesSince", () => {
  test("reads renames, edits and new files from git", () => {
    const root = mkdtempSync(join(scratch, "repo-"));
    mkdirSync(join(root, "packages/worker/src"), { recursive: true });
    mkdirSync(join(root, "packages/worker/test/helpers"), { recursive: true });
    sh(root, ["git", "init", "-q", "-b", "main"]);
    const body = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    const base = commit(
      root,
      {
        [FROM]: `import { a } from "./a";\n${body}\n`,
        [USER]: 'import { h } from "./h";\n',
        [RUN]: "export const r = 1;\n",
        [GONE]: "",
      },
      "base",
    );
    sh(root, ["chmod", "+x", join(root, RUN)]);
    sh(root, ["git", "mv", FROM, TO]);
    const moved = commit(
      root,
      {
        [TO]: `import { a } from "../../src/a";\n${body}\n`,
        [USER]: 'import { h } from "../test/h";\n',
        "packages/worker/src/new.ts": "export const n = 1;\n",
        [EMPTY]: "",
      },
      "move",
    );
    expect(changesSince(base, root)).toEqual([
      { from: null, to: EMPTY, renamed: false, opaque: false, removed: [], added: [] },
      {
        from: null,
        to: "packages/worker/src/new.ts",
        renamed: false,
        opaque: false,
        removed: [],
        added: ["export const n = 1;"],
      },
      change({ removed: ['import { h } from "./h";'], added: ['import { h } from "../test/h";'] }),
      { from: RUN, to: RUN, renamed: false, opaque: true, removed: [], added: [] },
      {
        ...MOVED,
        removed: ['import { a } from "./a";'],
        added: ['import { a } from "../../src/a";'],
      },
    ]);
    sh(root, ["git", "rm", "-q", GONE]);
    commit(root, {}, "delete");
    expect(changesSince(moved, root)).toEqual([
      { from: GONE, to: null, renamed: false, opaque: false, removed: [], added: [] },
    ]);
    expect(changesSince("missing", root)).toBeNull();
  });
});
