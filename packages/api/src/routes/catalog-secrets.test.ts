import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetPrinterSecrets, openDb } from "@conveyor/shared/db";
import { type BootedApi, bootApi } from "../../test/booted-api.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis printer secrets tests");

const modes: { name: string; skip: boolean; env: Record<string, string> }[] = [
  { name: "sqlite", skip: false, env: { CONVEYOR_QUEUE: "sqlite", CONVEYOR_QUEUE_UNSTABLE: "1" } },
  { name: "redis", skip: !url, env: { CONVEYOR_QUEUE: "redis", REDIS_URL: url ?? "" } },
];

const newPrinter = () => ({
  id: `secrets-${randomUUID()}`,
  transportId: "elegoo",
  name: "Secrets Elegoo",
  address: "10.0.0.7",
});

for (const mode of modes) {
  describe.skipIf(mode.skip)(
    `printer secrets on the ${mode.name} queue, booted through index.ts`,
    () => {
      const dir = mkdtempSync(join(tmpdir(), `conveyor-secrets-${mode.name}-`));
      let api: BootedApi | undefined;

      const base = () => {
        if (!api) throw new Error("api not booted");
        return api.base;
      };
      const put = (body: unknown) =>
        fetch(`${base()}/catalog/printers`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const stored = (id: string) => {
        const db = openDb(join(dir, "conveyor.db"));
        const read = dbGetPrinterSecrets(db, id);
        return read.ok ? read.value : "unreadable";
      };
      const rawRow = (id: string) => {
        const db = new Database(join(dir, "conveyor.db"), { readonly: true });
        try {
          return db
            .query<{ s: string | null }, [string]>(
              "SELECT secrets_json AS s FROM printers WHERE id = ?",
            )
            .get(id)?.s;
        } finally {
          db.close();
        }
      };

      beforeAll(async () => {
        api = await bootApi(dir, { ...mode.env, CONVEYOR_AUTH: "disabled" });
      });

      afterAll(async () => {
        openDb(":memory:").close();
        await api?.stop();
        rmSync(dir, { recursive: true, force: true });
      });

      test("saving one secret keeps the others, and the values never come back", async () => {
        const printer = newPrinter();
        expect((await put({ ...printer, secrets: { mainboardId: "board-7f3a" } })).status).toBe(
          200,
        );
        const saved = await put({ ...printer, name: "Renamed", secrets: { apiKey: "hunter2" } });
        expect([saved.status, await saved.json()]).toEqual([200, { ok: true }]);
        expect(stored(printer.id)).toEqual({ mainboardId: "board-7f3a", apiKey: "hunter2" });
        expect(rawRow(printer.id)).not.toContain("hunter2");

        const listed = await (await fetch(`${base()}/catalog/printers`)).text();
        expect(listed).toContain('"hasSecrets":true');
        expect(listed).toContain("Renamed");
        expect(listed).not.toContain("hunter2");
        expect(listed).not.toContain("board-7f3a");
      });

      test("a write without secrets keeps them, and null removes one key", async () => {
        const printer = newPrinter();
        const both = { mainboardId: "board-7f3a", apiKey: "hunter2" };
        expect((await put({ ...printer, secrets: both })).status).toBe(200);
        expect((await put({ ...printer, address: "10.0.0.8" })).status).toBe(200);
        expect(stored(printer.id)).toEqual(both);
        expect((await put({ ...printer, secrets: { apiKey: null } })).status).toBe(200);
        expect(stored(printer.id)).toEqual({ mainboardId: "board-7f3a" });
        expect((await put({ ...printer, secrets: { mainboardId: null } })).status).toBe(200);
        expect(stored(printer.id)).toBeUndefined();
        const listed = await (await fetch(`${base()}/catalog/printers`)).json();
        expect(listed).toContainEqual(
          expect.objectContaining({ id: printer.id, hasSecrets: false }),
        );
      });

      test("a write that would pass 16 secrets in total is refused and stores nothing", async () => {
        const printer = newPrinter();
        const sixteen = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, "v"]));
        expect((await put({ ...printer, secrets: sixteen })).status).toBe(200);
        const before = rawRow(printer.id);
        const refused = await put({ ...printer, secrets: { one: "too-many" } });
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({
          error: "secrets: at most 16 secrets per printer, counting the ones already stored",
        });
        expect(rawRow(printer.id)).toBe(before);
      });

      test("a write with secrets to a printer whose stored secrets don't decrypt answers 409 and changes nothing", async () => {
        const printer = newPrinter();
        expect((await put({ ...printer, secrets: { apiKey: "hunter2" } })).status).toBe(200);
        const db = new Database(join(dir, "conveyor.db"));
        try {
          db.query("UPDATE printers SET secrets_json = 'v1:garbage' WHERE id = ?").run(printer.id);
        } finally {
          db.close();
        }
        const refused = await put({ ...printer, name: "Renamed", secrets: { apiKey: "new" } });
        expect(refused.status).toBe(409);
        expect(await refused.json()).toEqual({
          error: `printer ${printer.id}'s stored secrets can't be read, so they can't be updated; clear its saved secrets and enter them again`,
        });
        expect(rawRow(printer.id)).toBe("v1:garbage");
        const listed = await (await fetch(`${base()}/catalog/printers`)).json();
        expect(listed).toContainEqual(
          expect.objectContaining({ id: printer.id, name: "Secrets Elegoo" }),
        );
        expect((await put({ ...printer, name: "Renamed" })).status).toBe(200);
        expect(rawRow(printer.id)).toBe("v1:garbage");
        expect((await put({ ...printer, secrets: null })).status).toBe(200);
        expect(rawRow(printer.id)).toBeNull();
        expect((await put({ ...printer, secrets: { apiKey: "new" } })).status).toBe(200);
        expect(stored(printer.id)).toEqual({ apiKey: "new" });
      });

      test("secrets: null clears every saved secret, even ones whose names you don't know", async () => {
        const printer = newPrinter();
        const saved = { mainboardId: "board-7f3a", mistyped: "hunter2" };
        expect((await put({ ...printer, secrets: saved })).status).toBe(200);
        expect((await put({ ...printer, secrets: {} })).status).toBe(200);
        expect(stored(printer.id)).toEqual(saved);
        expect((await put({ ...printer, name: "Cleared", secrets: null })).status).toBe(200);
        expect(rawRow(printer.id)).toBeNull();
        const listed = await (await fetch(`${base()}/catalog/printers`)).json();
        expect(listed).toContainEqual(
          expect.objectContaining({ id: printer.id, name: "Cleared", hasSecrets: false }),
        );
      });
    },
  );
}
