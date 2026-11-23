import { describe, expect, test } from "bun:test";
import { sourceImportErrors, symlinkErrors } from "./imports";

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
