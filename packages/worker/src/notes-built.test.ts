import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = import.meta.dir;
const sources = readdirSync(SRC)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => [name, readFileSync(join(SRC, name), "utf8")] as const);

describe("every job note the worker writes comes from the shared builder", () => {
  test("a stored notes field is only ever noted(run) or a pass-through", () => {
    const fields = sources.flatMap(([name, text]) =>
      [...text.matchAll(/\bnotes: (.+)$/gm)].map((m) => `${name}: ${m[1]?.trim()}`),
    );
    const allowed = /: (noted\(run[,)]|extra\.notes,|outcome\.notes \?\? null,|\[\],|Note\[\];)/;
    expect(fields.filter((field) => !allowed.test(field))).toEqual([]);
    expect(fields.length).toBeGreaterThan(5);
  });

  test("nothing pushes a hand-written string onto run.notes", () => {
    const pushes = sources.flatMap(([name, text]) =>
      [...text.matchAll(/notes\.push\(([^)]*\)?)/g)].map((m) => `${name}: ${m[1]}`),
    );
    expect(pushes.filter((push) => /: [`"']/.test(push))).toEqual([]);
    expect(pushes.length).toBeGreaterThan(3);
  });
});
