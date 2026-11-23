import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const facts = (changes: FileChange[] | null): MoveFacts => ({
  renamed: (from, to) => from === FROM && to === TO,
  changes,
  baseLines: () => 130,
  current: {
    api: { hit: 1, found: 1 },
    worker: { hit: 788, found: 957 },
    shared: { hit: 1, found: 1 },
    plugins: { hit: 1, found: 1 },
  },
  base: { worker: 83.99 },
  committed: { worker: 82.34 },
});

const run = (changes: FileChange[] | null) => reclassificationFloors([MOVE], [], facts(changes));

describe("a recorded move carries nothing else in its package", () => {
  test("allows the rename and one-line import-path edits, in any order", () => {
    const multiLine = change({
      removed: ['} from "./pipeline-harness";'],
      added: ['} from "../x";'],
    });
    const sorted = change({
      removed: ['import { a } from "./a";', 'import { b } from "./b";'],
      added: ['import { b } from "./b2";', 'import { a } from "./a";'],
    });
    const other = change({ from: "packages/api/src/x.ts", to: "packages/api/src/x.ts" });
    other.added = ["export const extra = 1;"];
    const result = run([MOVED, change({}), multiLine, sorted, other]);
    expect(result.errors).toEqual([]);
    expect(result.floors).toEqual({ worker: 82.34 });
  });

  test.each([
    ["a new file", change({ from: null, to: "packages/worker/src/new.ts", removed: [] })],
    ["a deleted file", change({ to: null, added: [] })],
    ["a code line", change({ added: ['import { harness } from "../x";', "const y = 1;"] })],
    ["an import that changes names", change({ added: ['import { other } from "../x";'] })],
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
      "changes worker beyond the recorded move and import-path edits",
    );
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
