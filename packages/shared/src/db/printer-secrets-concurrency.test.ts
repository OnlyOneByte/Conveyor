import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetPrinterSecrets, dbUpsertPrinter, openDb } from "./index";

const WRITERS = 8;
const dirs: string[] = [];

afterEach(() => {
  openDb(":memory:").close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const writer = (dbPath: string, key: string, startAt: number) => `
  const { dbUpsertPrinter, openDb } = await import(${JSON.stringify(join(import.meta.dir, "index.ts"))});
  const db = openDb(${JSON.stringify(dbPath)});
  await Bun.sleep(Math.max(0, ${startAt} - Date.now()));
  for (let i = 0; i < 5; i++) {
    dbUpsertPrinter(db, {
      id: "shared",
      transportId: "elegoo",
      name: "Shared",
      address: "10.0.0.9",
      secrets: { ${JSON.stringify(key)}: "v" + i, gone: null },
    });
  }
  db.close();
`;

describe("concurrent printer secret writes", () => {
  test("eight processes each saving their own key all keep theirs, and a removed key stays removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-secrets-race-"));
    dirs.push(dir);
    const dbPath = join(dir, "conveyor.db");
    const db = openDb(dbPath);
    const printer = { id: "shared", transportId: "elegoo", name: "Shared", address: "10.0.0.9" };
    dbUpsertPrinter(db, { ...printer, secrets: { seed: "s", gone: "g" } });

    const startAt = Date.now() + 1_500;
    const keys = Array.from({ length: WRITERS }, (_, i) => `k${i + 1}`);
    const runs = keys.map((key) =>
      Bun.spawn([process.execPath, "-e", writer(dbPath, key, startAt)], {
        stdout: "ignore",
        stderr: "pipe",
      }),
    );
    const results = await Promise.all(
      runs.map(async (run) => ({
        code: await run.exited,
        stderr: await new Response(run.stderr).text(),
      })),
    );
    expect(results.filter((result) => result.code !== 0)).toEqual([]);

    const stored = dbGetPrinterSecrets(db, "shared");
    expect(stored.ok).toBe(true);
    expect(Object.keys(stored.ok ? (stored.value ?? {}) : {}).sort()).toEqual(
      ["seed", ...keys].sort(),
    );
  }, 30_000);
});
