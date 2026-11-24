import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import { z } from "zod";
import { type BootedApi, bootApi } from "../../test/booted-api.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis job history tests");

const modes: { name: string; skip: boolean; env: Record<string, string> }[] = [
  { name: "sqlite", skip: false, env: { CONVEYOR_QUEUE: "sqlite", CONVEYOR_QUEUE_UNSTABLE: "1" } },
  { name: "redis", skip: !url, env: { CONVEYOR_QUEUE: "redis", REDIS_URL: url ?? "" } },
];

const listed = z.array(
  z.looseObject({ id: z.string(), unreadable: z.array(z.string()).optional() }),
);

for (const mode of modes) {
  describe.skipIf(mode.skip)(
    `GET /jobs-history with a corrupt row on the ${mode.name} queue`,
    () => {
      const dir = mkdtempSync(join(tmpdir(), `conveyor-history-unreadable-${mode.name}-`));
      let api: BootedApi | undefined;

      const base = () => {
        if (!api) throw new Error("api not booted");
        return api.base;
      };
      const db = () => openDb(join(dir, "conveyor.db"));
      const settle = (id: string) =>
        dbRecordJob(db(), {
          id,
          generatorId: "gridfinity",
          params: { gridX: 2 },
          printerId: "klipper-garage",
          profileId: "orca/klipper-pla-0.2",
          state: "done",
        });

      beforeAll(async () => {
        api = await bootApi(dir, { ...mode.env, CONVEYOR_AUTH: "disabled" });
      });

      afterAll(async () => {
        openDb(":memory:").close();
        await api?.stop();
        rmSync(dir, { recursive: true, force: true });
      });

      test("answers 200 with every job, marking the one whose params do not parse", async () => {
        const good = [`good-${randomUUID()}`, `good-${randomUUID()}`];
        const bad = `bad-${randomUUID()}`;
        for (const id of [good[0], bad, good[1]]) settle(id ?? "");
        db().query("UPDATE jobs SET params_json = '{' WHERE id = ?").run(bad);

        const res = await fetch(`${base()}/jobs-history`);
        expect(res.status).toBe(200);
        const jobs = listed.parse(await res.json());
        expect(jobs.map((job) => job.id)).toEqual(expect.arrayContaining([...good, bad]));
        expect(jobs.find((job) => job.id === bad)?.unreadable).toEqual(["params"]);
        for (const id of good)
          expect(jobs.find((job) => job.id === id)).not.toHaveProperty("unreadable");

        const one = await fetch(`${base()}/jobs-history/${bad}`);
        expect(one.status).toBe(200);
        expect(await one.json()).toMatchObject({ id: bad, state: "done", unreadable: ["params"] });
      });

      test('JSON of the wrong shape is left out and marked too: params 7, error "boom", timings {}', async () => {
        const bad = `shape-${randomUUID()}`;
        settle(bad);
        db()
          .query(
            "UPDATE jobs SET params_json = '7', error_json = '\"boom\"', timings_json = '{}' WHERE id = ?",
          )
          .run(bad);

        const res = await fetch(`${base()}/jobs-history`);
        expect(res.status).toBe(200);
        const jobs = listed.parse(await res.json());
        expect(jobs.find((job) => job.id === bad)?.unreadable).toEqual([
          "params",
          "error",
          "timings",
        ]);

        const one = await fetch(`${base()}/jobs-history/${bad}`);
        expect(one.status).toBe(200);
        const body = await one.json();
        expect(body).toMatchObject({ id: bad, unreadable: ["params", "error", "timings"] });
        expect(body).not.toHaveProperty("error");
        expect(body).not.toHaveProperty("timings");
        expect(body).toMatchObject({ request: { generator: { id: "gridfinity" } } });
        expect(JSON.stringify(body)).not.toContain('"params":');
      });
    },
  );
}
