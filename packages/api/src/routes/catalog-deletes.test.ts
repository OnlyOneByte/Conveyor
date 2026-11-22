import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertPrinter, dbUpsertProfile, openDb } from "@conveyor/shared/db";
import { enqueueJob } from "@conveyor/shared/queue";
import { Job } from "bullmq";
import Fastify from "fastify";
import { connection, jobQueue, redis } from "../queue.js";
import { registerCatalogRoutes } from "./catalog";
import { countLiveJobs } from "./jobs.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-catalog-deletes-"));
const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = join(dir, "conveyor.db");

const app = Fastify();
let base = "";

const del = async (url: string) => {
  const res = await fetch(`${base}${url}`, { method: "DELETE" });
  return { status: res.status, body: await res.json() };
};
const request = (printerId: string, profileId: string) => ({
  generator: { id: "gridfinity", params: {} },
  printerId,
  profileId,
});
const finish = (jobId: string) =>
  openDb().query("UPDATE jobs SET state = 'done' WHERE id = ?").run(jobId);

beforeAll(async () => {
  const db = openDb();
  dbUpsertPrinter(db, { id: "busy", transportId: "moonraker", name: "Busy", address: "10.0.0.2" });
  dbUpsertProfile(db, {
    id: "custom",
    slicerId: "prusa",
    name: "Custom",
    path: "/profiles/prusa-marlin-pla-0.2",
    gcodeFlavor: "marlin",
  });
  await registerCatalogRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await app.close();
  connection.disconnect();
  redis.disconnect();
  process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("DELETE /catalog/printers/:id", () => {
  test("an unknown printer is a 404", async () => {
    expect(await del("/catalog/printers/ghost")).toEqual({
      status: 404,
      body: { error: "unknown printer ghost" },
    });
  });

  test("a printer a queued job uses is a 409 until the job finishes", async () => {
    enqueueJob(openDb(), { id: "printer-job", request: request("busy", "prusa/klipper-pla-0.2") });
    expect(await del("/catalog/printers/busy")).toEqual({
      status: 409,
      body: { error: "printer busy is used by 1 queued or running job(s)" },
    });
    finish("printer-job");
    expect((await del("/catalog/printers/busy")).status).toBe(200);
    expect((await del("/catalog/printers/busy")).status).toBe(404);
  });
});

describe("DELETE /catalog/profiles/:id", () => {
  test("an unknown profile is a 404", async () => {
    expect((await del("/catalog/profiles/ghost")).status).toBe(404);
  });

  test("a bundled profile is a 409 and stays listed", async () => {
    expect(await del("/catalog/profiles/orca%2Fklipper-pla-0.2")).toEqual({
      status: 409,
      body: { error: "profile orca/klipper-pla-0.2 is bundled and cannot be deleted" },
    });
    const listed = await (await fetch(`${base}/catalog/profiles`)).json();
    expect(listed).toContainEqual(expect.objectContaining({ id: "orca/klipper-pla-0.2" }));
  });

  test("a profile a queued job uses is a 409 until the job finishes", async () => {
    enqueueJob(openDb(), { id: "profile-job", request: request("klipper-garage", "custom") });
    expect(await del("/catalog/profiles/custom")).toEqual({
      status: 409,
      body: { error: "profile custom is used by 1 queued or running job(s)" },
    });
    finish("profile-job");
    expect((await del("/catalog/profiles/custom")).status).toBe(200);
  });
});

describe("countLiveJobs on the Redis queue", () => {
  test("counts waiting and active BullMQ jobs that name the printer or profile", async () => {
    const jobs = [
      new Job(jobQueue, "job", request("p1", "orca/klipper-pla-0.2"), {}, "a"),
      new Job(jobQueue, "job", request("p1", "custom"), {}, "b"),
      new Job(jobQueue, "job", request("p2", "custom"), {}, "c"),
    ];
    const getJobs = spyOn(jobQueue, "getJobs").mockResolvedValue(jobs);
    try {
      expect(await countLiveJobs("printerId", "p1")).toBe(2);
      expect(await countLiveJobs("profileId", "custom")).toBe(2);
      expect(await countLiveJobs("printerId", "p3")).toBe(0);
      expect(getJobs.mock.calls[0]?.[0]).toEqual([
        "waiting",
        "active",
        "delayed",
        "prioritized",
        "paused",
        "waiting-children",
      ]);
    } finally {
      getJobs.mockRestore();
    }
  });
});
