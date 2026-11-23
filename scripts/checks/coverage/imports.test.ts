import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runtimeResolver, sourceImportErrors, symlinkErrors } from "./imports";

const flagged = (path: string, text: string) => sourceImportErrors([path], () => text);

const SRC = "packages/api/src/route.ts";

describe("sourceImportErrors", () => {
  test.each([
    ["a static import", 'import { db } from "../../shared/test/helpers/db.ts";\n'],
    ["a dynamic import", 'const m = await import("../../shared/test/helpers/db.ts");\n'],
    ["a require", 'const m = require("../../shared/test/helpers/db.ts");\n'],
    ["a template literal", "const m = await import(`../../shared/test/helpers/$" + "{name}`);\n"],
    ["a concatenation", 'const m = await import("../../shared/test/" + "helpers/db.ts");\n'],
    ["a variable", 'const p = "../../shared/test/helpers/db.ts";\nawait import(p);\n'],
    ["a ./ inside the path", 'import { db } from "../../shared/test/./helpers/db.ts";\n'],
    ["a // inside the path", 'import { db } from "../../shared/test//helpers/db.ts";\n'],
    [
      "import.meta.url",
      'await import(new URL("../../shared/test/helpers/db.ts", import.meta.url).href);\n',
    ],
    ["path.join", 'await import(join(root, "packages", "shared", "test", "helpers", "db.ts"));\n'],
    ["the helper folder itself", 'import { db } from "../../shared/test/helpers";\n'],
  ])("flags %s of a test helper", (_form, text) => {
    expect(flagged(SRC, text)).toHaveLength(1);
  });

  test("flags a relative import that resolves into a helper folder without naming one", () => {
    const helperSibling = "packages/shared/test/setup.ts";
    expect(flagged(helperSibling, 'import { db } from "./helpers/db";\n')).toEqual([
      "packages/shared/test/setup.ts imports the test helper ./helpers/db; only tests may",
    ]);
    expect(flagged(helperSibling, "const m = await import(`./helpers/db`);\n")).toHaveLength(1);
  });

  test.each([
    ['import { cases } from "./route.test";\n', "./route.test"],
    ['import { cases } from "./route.spec.ts";\n', "./route.spec.ts"],
    ['const m = await import("../fixtures.test.mjs");\n', "../fixtures.test.mjs"],
  ])("flags a source that imports a test file: %s", (text, specifier) => {
    expect(flagged(SRC, text)).toEqual([
      `${SRC} imports the test file ${specifier}; only tests may`,
    ]);
  });

  test("passes sources whose imports stay out of test code", () => {
    const text = [
      'import { x } from "./helpers/x";',
      'import { y } from "@conveyor/shared";',
      'import "../lib/testing-utils";',
      'const label = "helpers for tests";',
    ].join("\n");
    expect(flagged(SRC, text)).toEqual([]);
  });
});

describe("symlinkErrors", () => {
  test("flags a tracked symlink under packages/ or plugins/ only", () => {
    const staged = [
      "100644 aaa 0\tpackages/api/src/app.ts",
      "120000 bbb 0\tpackages/api/src/helpers",
      "120000 ccc 0\tplugins/slicers/orca/src/link.ts",
      "120000 ddd 0\tdocs/link.md",
    ].join("\0");
    expect(symlinkErrors(staged)).toEqual([
      "packages/api/src/helpers is a symlink; the coverage check can't see what it points at",
      "plugins/slicers/orca/src/link.ts is a symlink; the coverage check can't see what it points at",
    ]);
  });

  test("passes a tree with no symlinks", () => {
    expect(symlinkErrors("100644 aaa 0\tpackages/api/src/app.ts\0")).toEqual([]);
  });
});

const scratch = mkdtempSync(join(tmpdir(), "conveyor-imports-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function aliasRepo() {
  const root = mkdtempSync(join(scratch, "repo-"));
  const files: Record<string, string> = {
    "packages/worker/package.json": JSON.stringify({
      name: "probe-worker",
      imports: { "#probe/*": "./test/helpers/*.ts" },
      exports: {
        "./fixtures": "./test/helpers/probe-helper.ts",
        "./cases": "./src/x.spec.ts",
      },
    }),
    "packages/worker/test/helpers/probe-helper.ts": "export const secret = 42;\n",
    "packages/worker/src/x.spec.ts": "export const hidden = 1;\n",
    "packages/worker/src/run.ts": "export const run = 1;\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "tools"));
  symlinkSync("../packages/worker/test/helpers", join(root, "tools", "probe-link"));
  return root;
}

describe("sourceImportErrors with the runtime resolver", () => {
  const FROM = "packages/worker/src/main.ts";

  test.each([
    ["a package.json imports alias", 'import { secret } from "#probe/probe-helper";\n'],
    ["a package.json exports entry", 'import { secret } from "probe-worker/fixtures";\n'],
    [
      "a symlink outside packages/",
      'import { secret } from "../../../tools/probe-link/probe-helper";\n',
    ],
  ])("flags %s that lands in a helper folder", (_route, text) => {
    const root = aliasRepo();
    const [error, ...rest] = sourceImportErrors([FROM], () => text, runtimeResolver(root));
    expect(rest).toEqual([]);
    expect(error).toStartWith(`${FROM} imports the test helper `);
  });

  test("flags an alias that resolves to a spec file", () => {
    const root = aliasRepo();
    const text = 'import { hidden } from "probe-worker/cases";\n';
    expect(sourceImportErrors([FROM], () => text, runtimeResolver(root))).toEqual([
      `${FROM} imports the test file probe-worker/cases; only tests may`,
    ]);
  });

  test("passes an import that resolves to ordinary source, and skips one that doesn't resolve", () => {
    const root = aliasRepo();
    const text = 'import { run } from "./run";\nimport { gone } from "./missing";\n';
    expect(sourceImportErrors([FROM], () => text, runtimeResolver(root))).toEqual([]);
  });
});
