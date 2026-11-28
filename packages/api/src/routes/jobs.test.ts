import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTIVE_JOBS_KEY, type JobRequest, type JobState, jobSnapshotKey } from "@conveyor/shared";
import { dbRecordJob, dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import { Job } from "bullmq";
import Fastify from "fastify";
import { z } from "zod";
import { closeQueue } from "../../test/helpers/close-queue.ts";
import { connection, jobQueue, redis } from "../queue.js";
import { registerJobRoutes } from "./jobs.js";

connection.disconnect();
redis.disconnect();

const dir = realpathSync(mkdtempSync(join(tmpdir(), "conveyor-jobs-")));
const dataDir = join(dir, "data");
const previous = { db: process.env.DB_PATH, data: process.env.DATA_DIR };
const store = new Map<string, string>();
const active = new Set<string>();
const app = Fastify();
let base = "";

const request: JobRequest = {
  generator: { id: "gridfinity", params: { gridX: 2 } },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

function installFakes() {
  return {
    add: spyOn(jobQueue, "add").mockImplementation(
      async (name, data, opts) => new Job(jobQueue, name, data, opts, opts?.jobId),
    ),
    get: spyOn(redis, "get").mockImplementation(async (key) => store.get(String(key)) ?? null),
    mget: spyOn(redis, "mget").mockImplementation(async (...keys) =>
      keys.flat().map((key) => store.get(String(key)) ?? null),
    ),
    getJob: spyOn(jobQueue, "getJob").mockImplementation(async () => undefined),
    smembers: spyOn(redis, "smembers").mockImplementation(async () => [...active]),
    srem: spyOn(redis, "srem").mockImplementation(async (_key, ...members) => {
      for (const m of members.flat()) active.delete(String(m));
      return members.length;
    }),
  };
}

let fakes: ReturnType<typeof installFakes>;

const get = (path: string) => fetch(`${base}${path}`);
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function snapshot(jobId: string, state: JobState, at: number): void {
  store.set(jobSnapshotKey(jobId), JSON.stringify({ jobId, state, at }));
}

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  process.env.DATA_DIR = dataDir;
  mkdirSync(dataDir);
  openDb();
  fakes = installFakes();
  await registerJobRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

beforeEach(() => {
  store.clear();
  active.clear();
  for (const spy of Object.values(fakes)) spy.mockClear();
});

afterAll(async () => {
  try {
    app.server.closeAllConnections();
    await app.close();
    mock.restore();
    openDb().close();
    if (previous.db === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous.db;
    if (previous.data === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous.data;
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await closeQueue(process.env.REDIS_URL);
  }
});

describe("POST /jobs", () => {
  test("enqueues a compatible job under a fresh id and answers 202", async () => {
    const res = await post("/jobs", request);
    expect(res.status).toBe(202);
    const { jobId } = z.object({ jobId: z.string() }).parse(await res.json());
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fakes.add).toHaveBeenCalledTimes(1);
    expect(fakes.add).toHaveBeenCalledWith(
      "job",
      {
        ...request,
        generator: {
          id: "gridfinity",
          params: expect.objectContaining({ gridX: 2 }),
        },
      },
      { jobId },
    );
  });
  test("a body that is not a job request is a 400 and enqueues nothing", async () => {
    const res = await post("/jobs", { generator: "gridfinity" });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
    expect(fakes.add).not.toHaveBeenCalled();
  });

  test("an unknown profile is a 404 naming both ids", async () => {
    const res = await post("/jobs", { ...request, profileId: "nope" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown printer klipper-garage or profile nope" });
    expect(fakes.add).not.toHaveBeenCalled();
  });

  test("an unknown generator is a 400 and enqueues nothing", async () => {
    const res = await post("/jobs", { ...request, generator: { id: "openscad" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown generator: openscad" });
    expect(fakes.add).not.toHaveBeenCalled();
  });

  test("a generator outside the printer's allowlist is a 400", async () => {
    dbUpsertPrinter(openDb(), {
      id: "locked",
      transportId: "moonraker",
      name: "Locked",
      address: "127.0.0.1:7125",
      allowedGenerators: [],
    });
    const res = await post("/jobs", { ...request, printerId: "locked" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("its allowlist is empty") });
    expect(fakes.add).not.toHaveBeenCalled();
  });
});

describe("GET /jobs/active", () => {
  test("is empty when nothing is in flight", async () => {
    expect(await (await get("/jobs/active")).json()).toEqual([]);
  });

  test("returns live snapshots newest first and prunes stale members", async () => {
    for (const id of ["old", "new", "finished", "vanished"]) active.add(id);
    snapshot("old", "printing", 10);
    snapshot("new", "slicing", 20);
    snapshot("finished", "done", 30);
    expect(await (await get("/jobs/active")).json()).toEqual([
      { jobId: "new", state: "slicing", at: 20 },
      { jobId: "old", state: "printing", at: 10 },
    ]);
    expect(fakes.srem).toHaveBeenCalledWith(ACTIVE_JOBS_KEY, "finished", "vanished");
    expect([...active].sort()).toEqual(["new", "old"]);
  });

  test("still answers when pruning the stale members fails", async () => {
    active.add("finished");
    snapshot("finished", "failed", 1);
    fakes.srem.mockRejectedValueOnce(new Error("redis down"));
    const res = await get("/jobs/active");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("does not prune when every member is live", async () => {
    active.add("live");
    snapshot("live", "queued", 5);
    await get("/jobs/active");
    expect(fakes.srem).not.toHaveBeenCalled();
  });
});

describe("GET /jobs/:id", () => {
  test("returns the stored snapshot", async () => {
    const id = "0b0c4b9e-5d33-4c52-9f3a-7f1c2a4e8d10";
    snapshot(id, "printing", 42);
    const res = await get(`/jobs/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: id, state: "printing", at: 42 });
  });

  test("an unknown job is a 404", async () => {
    const res = await get("/jobs/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown job" });
  });
});

describe("GET /jobs/:id/artifact/:kind", () => {
  const settled = (id: string, gcodePath?: string) => {
    const { printerId, profileId } = request;
    dbRecordJob(openDb(), {
      id,
      generatorId: "gridfinity",
      printerId,
      profileId,
      state: "done",
      gcodePath,
    });
  };

  test("streams a settled job's gcode as a named attachment", async () => {
    const workDir = join(dataDir, "printed");
    mkdirSync(workDir);
    writeFileSync(join(workDir, "model.gcode"), "G28\n");
    settled("printed", join(workDir, "model.gcode"));
    const res = await get("/jobs/printed/artifact/gcode");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/x.gcode");
    expect(res.headers.get("content-length")).toBe("4");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="model.gcode"');
    expect(await res.text()).toBe("G28\n");
  });

  test("the engine log downloads as plain text", async () => {
    const workDir = join(dataDir, "logged");
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "engine.log"), "$ orca-slicer\n[exited 0]\n");
    settled("logged");
    const res = await get("/jobs/logged/artifact/log");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="engine.log"');
    expect(await res.text()).toBe("$ orca-slicer\n[exited 0]\n");
  });

  test("an artifact kind other than model, gcode or log is a 404", async () => {
    const res = await get("/jobs/printed/artifact/config");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown artifact kind config" });
  });

  test("an artifact error keeps its own status and message", async () => {
    const res = await get("/jobs/never-ran/artifact/model");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no settled job with id never-ran" });
  });
});
