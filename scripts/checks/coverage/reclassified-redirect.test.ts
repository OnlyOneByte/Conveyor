import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commit, sh } from "../test-repo";
import { runtimeResolver } from "./imports";
import { reclassificationFloors } from "./reclassified";
import { changesSince, renamedSince, treeAt } from "./runner";

const SRC = "packages/worker/src";
const FROM = `${SRC}/pipeline-harness.ts`;
const TO = "packages/worker/test/helpers/pipeline-harness.ts";
const USER = `${SRC}/pipeline.test.ts`;
const LOOP = "packages/worker/test/helpers/loop-harness.ts";
const BODY = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n");

const BASE_FILES = {
  [FROM]: `import { runJob } from "./pipeline";\n${BODY}\n`,
  [`${SRC}/pipeline.ts`]: "export const runJob = 1;\n",
  [`${SRC}/real.ts`]: "export const r = 1;\n",
  [`${SRC}/stub.ts`]: "export const r = 2;\n",
  [`${SRC}/setup-real.ts`]: "export {};\n",
  [`${SRC}/setup-evil.ts`]: "export {};\n",
  [LOOP]: 'import { v0 } from "../../src/pipeline-harness";\n',
};

const MOVED_FILES = {
  [TO]: `import { runJob } from "../../src/pipeline";\n${BODY}\n`,
  [LOOP]: 'import { v0 } from "./pipeline-harness";\n',
};

const scratch = mkdtempSync(join(tmpdir(), "conveyor-redirect-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function judge(before: string, after: string, moved: Record<string, string> = {}) {
  const root = mkdtempSync(join(scratch, "repo-"));
  mkdirSync(join(root, SRC), { recursive: true });
  mkdirSync(join(root, "packages/worker/test/helpers"), { recursive: true });
  sh(root, ["git", "init", "-q", "-b", "main"]);
  const harness = 'import { v1 } from "./pipeline-harness";\n';
  const base = commit(root, { ...BASE_FILES, [USER]: `${harness}${before}` }, "base");
  sh(root, ["git", "mv", FROM, TO]);
  const head = 'import { v1 } from "../test/helpers/pipeline-harness";\n';
  commit(root, { ...MOVED_FILES, [USER]: `${head}${after}`, ...moved }, "move");
  const tree = treeAt(base, root);
  try {
    return reclassificationFloors([{ package: "worker", from: FROM, to: TO, floor: 82.34 }], [], {
      renamed: renamedSince(base, root),
      changes: changesSince(base, root),
      resolveAtBase: tree.resolve,
      resolveAtHead: runtimeResolver(root),
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
  } finally {
    tree.dispose();
  }
}

describe("an import path edit must follow the recorded move", () => {
  test("allows the real pipeline-harness move, resolved at the base and at HEAD", () => {
    const result = judge('import { r } from "./real";\n', 'import { r } from "./real";\n');
    expect(result.errors).toEqual([]);
    expect(result.floors).toEqual({ worker: 82.34 });
  });

  test.each([
    [
      "a test pointed from real to a stub",
      'import { r } from "./real";',
      'import { r } from "./stub";',
    ],
    ["a side-effect import redirected", 'import "./setup-real";', 'import "./setup-evil";'],
    ["export * redirected", 'export * from "./real";', 'export * from "./stub";'],
    [
      "a named re-export redirected",
      'export { r as go } from "./real";',
      'export { r as go } from "./stub";',
    ],
    [
      "two specifiers swapped",
      'import { r } from "./real";\nimport { r as s } from "./stub";',
      'import { r } from "./stub";\nimport { r as s } from "./real";',
    ],
    [
      "an import-shaped line in a template string",
      'export const t = `\nimport { r } from "./real";\n`;',
      'export const t = `\nimport { r } from "./stub";\n`;',
    ],
  ])("refuses %s", (_case, before, after) => {
    const result = judge(`${before}\n`, `${after}\n`);
    expect(result.floors).toEqual({});
    expect(result.errors).toEqual([
      `scripts/checks/coverage/baseline/reclassified.json: ${USER} changes beside a recorded move; only the move, import paths that follow it, coverage baselines and Markdown may`,
    ]);
  });

  test("refuses a bunfig.toml ignore pattern that hides a test beside the move", () => {
    const bunfig = { "bunfig.toml": `[test]\npathIgnorePatterns = ["${USER}"]\n` };
    const result = judge("", "", bunfig);
    expect(result.floors).toEqual({});
    expect(result.errors.join("\n")).toContain(
      "bunfig.toml changes beside a recorded move; only the move, import paths that follow it, coverage baselines and Markdown may",
    );
  });

  test("refuses the moved file pointing its own import somewhere new", () => {
    const moved = { [TO]: `import { runJob } from "../../src/stub";\n${BODY}\n` };
    const result = judge("", "", moved);
    expect(result.floors).toEqual({});
    expect(result.errors.join("\n")).toContain(`${TO} changes beside a recorded move`);
  });
});
