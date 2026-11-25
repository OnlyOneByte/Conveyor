import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbDeletePrinter, dbListPrinters, openDb } from "@conveyor/shared/db";
import Fastify, { type FastifyInstance } from "fastify";
import { closeQueue } from "../../test/helpers/close-queue.ts";
import { connection, jobQueue, redis } from "../queue.js";
import { registerCatalogRoutes } from "./catalog.js";
import { registerJobRoutes } from "./jobs.js";
import { countLiveJobs as countSqliteLiveJobs } from "./jobs-sqlite.js";

connection.disconnect();
redis.disconnect();

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-"));
const dbPath = join(dir, "conveyor.db");
const previousDbPath = process.env.DB_PATH;
const add = spyOn(jobQueue, "add");
spyOn(redis, "smembers").mockResolvedValue([]);
let app: FastifyInstance;
let base: string;

const get = (url: string) => fetch(`${base}${url}`);

beforeAll(async () => {
  const seeded = openDb(dbPath);
  for (const p of dbListPrinters(seeded)) dbDeletePrinter(seeded, p.id);
  openDb(join(dir, "other.db")).close();
  process.env.DB_PATH = dbPath;
  openDb(dbPath);

  app = Fastify();
  await registerCatalogRoutes(app, countSqliteLiveJobs);
  await registerJobRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  try {
    await app.close();
    mock.restore();
    openDb(dbPath).close();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await closeQueue();
  }
});

describe("API with zero printers", () => {
  test("lists no printers", async () => {
    const res = await get("/catalog/printers");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("still lists profiles and an empty history", async () => {
    const profiles = await get("/catalog/profiles");
    expect(profiles.status).toBe(200);
    expect(await profiles.json()).toContainEqual(
      expect.objectContaining({ id: "orca/klipper-pla-0.2" }),
    );
    const history = await get("/jobs-history");
    expect(await history.json()).toEqual([]);
    const active = await get("/jobs/active");
    expect(await active.json()).toEqual([]);
  });

  test("rejects a job naming a printer that does not exist", async () => {
    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generator: { id: "openscad", params: {} },
        printerId: "klipper-garage",
        profileId: "orca/klipper-pla-0.2",
      }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("klipper-garage") });
    expect(add).not.toHaveBeenCalled();
  });
});
