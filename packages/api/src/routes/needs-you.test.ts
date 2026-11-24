import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbGetJob, dbRecordJob, openDb } from "@conveyor/shared/db";
import { enqueueJob } from "@conveyor/shared/queue";
import Fastify from "fastify";
import { z } from "zod";
import { registerNeedsYouRoutes } from "./job-common.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-needs-you-"));
const previousDbPath = process.env.DB_PATH;
const app = Fastify();
let base = "";
let clock = 1_000;

const call = async (method: "GET" | "POST", path: string) => {
  const res = await fetch(`${base}${path}`, { method });
  const body: unknown = await res.json();
  return { status: res.status, body };
};
const idsOf = (body: unknown) =>
  z
    .array(z.object({ id: z.string() }))
    .parse(body)
    .map((job) => job.id);

function settle(id: string, state: "done" | "failed" | "canceled", updatedAt: number) {
  dbRecordJob(openDb(), { id, generatorId: "g", printerId: "p1", profileId: "prof", state });
  openDb().query("UPDATE jobs SET updated_at = ? WHERE id = ?").run(updatedAt, id);
}

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb().exec("DELETE FROM jobs");
  settle("old-failure", "failed", 100);
  settle("new-failure", "failed", 300);
  settle("finished", "done", 200);
  settle("stopped", "canceled", 250);
  enqueueJob(openDb(), {
    id: "running",
    request: { generator: { id: "g" }, printerId: "p1", profileId: "prof" },
  });
  registerNeedsYouRoutes(app, () => clock);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  openDb().close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("the Needs-you list and dismissing a failure", () => {
  test("lists failed jobs only, newest first", async () => {
    expect(idsOf((await call("GET", "/jobs/needs-you")).body)).toEqual([
      "new-failure",
      "old-failure",
    ]);
  });

  test("a dismissed failure leaves the list, stays failed, and keeps its first dismissal time", async () => {
    clock = 5_000;
    expect(await call("POST", "/jobs/new-failure/dismiss")).toEqual({
      status: 200,
      body: { ok: true, jobId: "new-failure", dismissedAt: 5_000 },
    });
    clock = 9_000;
    expect((await call("POST", "/jobs/new-failure/dismiss")).body).toEqual({
      ok: true,
      jobId: "new-failure",
      dismissedAt: 5_000,
    });
    expect(idsOf((await call("GET", "/jobs/needs-you")).body)).toEqual(["old-failure"]);
    expect(dbGetJob(openDb(), "new-failure")).toMatchObject({
      state: "failed",
      dismissedAt: 5_000,
    });
  });

  test.each([
    ["finished", "done"],
    ["stopped", "canceled"],
    ["running", "queued"],
  ])("refuses to dismiss %s, which is %s, and changes nothing", async (id, state) => {
    expect(await call("POST", `/jobs/${id}/dismiss`)).toEqual({
      status: 409,
      body: { ok: false, jobId: id, error: `only a failed job can be dismissed; it is ${state}` },
    });
    expect(dbGetJob(openDb(), id)?.dismissedAt).toBeUndefined();
  });

  test("an unknown job is a 404", async () => {
    expect(await call("POST", "/jobs/ghost/dismiss")).toEqual({
      status: 404,
      body: { ok: false, jobId: "ghost", error: "unknown job" },
    });
  });
});
