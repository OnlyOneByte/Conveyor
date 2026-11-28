import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { z } from "zod";
import { registerCatalogRoutes } from "./catalog.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-jobs-history-"));
const previousDbPath = process.env.DB_PATH;
const app = Fastify();
let base = "";

const get = async (url: string) => {
  const res = await fetch(`${base}${url}`);
  const body: unknown = await res.json();
  return { status: res.status, body };
};

function settle(id: string, updatedAt: number, state: "done" | "failed", printerId = "p1") {
  dbRecordJob(openDb(), { id, generatorId: "g", printerId, profileId: "prof", state });
  openDb().query("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, id);
}

const idsOf = (body: unknown) =>
  z
    .array(z.object({ id: z.string() }))
    .parse(body)
    .map((job) => job.id);

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb().exec("DELETE FROM jobs");
  settle("a", 1_000, "done");
  settle("b", 2_000, "failed");
  settle("c", 3_000, "done", "p2");
  settle("d", 4_000, "done");
  await registerCatalogRoutes(app, async () => 0);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  app.server.closeAllConnections();
  await app.close();
  openDb().close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /jobs-history paging and filters", () => {
  test("pages back from a cursor and applies the filters", async () => {
    expect(idsOf((await get("/jobs-history?limit=2")).body)).toEqual(["d", "c"]);
    expect(idsOf((await get("/jobs-history?limit=2&before=3000:c")).body)).toEqual(["b", "a"]);
    expect(idsOf((await get("/jobs-history?state=failed")).body)).toEqual(["b"]);
    expect(idsOf((await get("/jobs-history?printerId=p2")).body)).toEqual(["c"]);
    expect(idsOf((await get("/jobs-history?since=2000&until=4000")).body)).toEqual(["c", "b"]);
  });

  test.each([
    ["state=queued", "state"],
    ["before=3000", "before"],
    ["before=c:3000", "before"],
    ["since=yesterday", "since"],
    ["until=-1", "until"],
    ["printerId=", "printerId"],
    ["printerId=p1&printerId=p2", "printerId"],
  ])("refuses ?%s with a 400 naming %s", async (query, field) => {
    const res = await get(`/jobs-history?${query}`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
  });
});

describe("GET /jobs-history/counts", () => {
  test("counts finished jobs per state under the printer and time filters", async () => {
    expect(await get("/jobs-history/counts")).toEqual({
      status: 200,
      body: { done: 3, failed: 1, canceled: 0 },
    });
    expect((await get("/jobs-history/counts?printerId=p1&until=4000")).body).toEqual({
      done: 1,
      failed: 1,
      canceled: 0,
    });
    expect((await get("/jobs-history/counts?since=soon")).status).toBe(400);
  });
});
