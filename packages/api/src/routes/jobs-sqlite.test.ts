import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { claimJob, enqueueJob, type Lease, writeStatus } from "@conveyor/shared/queue";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCatalogRoutes } from "./catalog.js";
import { countLiveJobs as countSqliteLiveJobs, registerJobRoutes } from "./jobs-sqlite.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-sqlite-"));
const dbPath = join(dir, "conveyor.db");
const previousDbPath = process.env.DB_PATH;
const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};
let db: Database;
let app: FastifyInstance;
let base = "";
let n = 0;

beforeAll(async () => {
  process.env.DB_PATH = dbPath;
  db = openDb(dbPath);
  app = Fastify();
  await app.register(websocket);
  await registerCatalogRoutes(app, countSqliteLiveJobs);
  await registerJobRoutes(app, db);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  app.server.closeAllConnections();
  await app.close();
  db.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

function queued(): string {
  const id = `job-${++n}`;
  enqueueJob(db, { id, request });
  return id;
}

function claimed(): Lease {
  db.query(
    "UPDATE jobs SET state = 'done' WHERE state NOT IN ('done', 'failed', 'canceled')",
  ).run();
  const id = queued();
  const lease = claimJob(db, "w1")?.lease;
  if (lease?.jobId !== id) throw new Error("not claimed");
  return lease;
}

async function inject(method: "GET" | "POST", url: string, payload?: unknown) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: payload === undefined ? {} : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body: unknown = await res.json();
  return { statusCode: res.status, json: <T = Record<string, unknown>>() => body as T };
}

describe("job routes on the sqlite queue", () => {
  test("POST /jobs validates, then enqueues the job and answers 202", async () => {
    expect((await inject("POST", "/jobs", { printerId: 1 })).statusCode).toBe(400);
    const missing = await inject("POST", "/jobs", { ...request, printerId: "nowhere" });
    expect(missing.statusCode).toBe(404);
    const res = await inject("POST", "/jobs", request);
    expect([res.statusCode, res.json()]).toEqual([202, expect.anything()]);
    const { jobId } = res.json<{ jobId: string }>();
    expect(db.query("SELECT state, printer_id FROM jobs WHERE id = ?").get(jobId)).toEqual({
      state: "queued",
      printer_id: "klipper-garage",
    });
  });

  test("GET /jobs/:id answers the snapshot, or 404", async () => {
    const id = queued();
    const res = await inject("GET", `/jobs/${id}`);
    expect(res.json()).toMatchObject({ jobId: id, state: "queued" });
    expect((await inject("GET", "/jobs/nope")).statusCode).toBe(404);
  });

  test("GET /jobs/active lists unfinished jobs only, and history lists finished ones only", async () => {
    const live = queued();
    const finished = queued();
    db.query("UPDATE jobs SET state = 'done' WHERE id = ?").run(finished);
    const active = (await inject("GET", "/jobs/active")).json<{ jobId: string }[]>();
    expect(active.map((j) => j.jobId)).toContain(live);
    expect(active.map((j) => j.jobId)).not.toContain(finished);
    const history = (await inject("GET", "/jobs-history")).json<{ id: string }[]>();
    expect(history.map((j) => j.id)).toContain(finished);
    expect(history.map((j) => j.id)).not.toContain(live);
    expect((await inject("GET", `/jobs-history/${live}`)).statusCode).toBe(404);
  });

  test("GET /jobs/:id and /jobs/active add the job's printer, profile, generator and creation time", async () => {
    const id = queued();
    const { created_at } = db.query("SELECT created_at FROM jobs WHERE id = ?").get(id) as {
      created_at: number;
    };
    const fields = { ...request, createdAt: created_at };
    expect((await inject("GET", `/jobs/${id}`)).json<unknown>()).toEqual({
      jobId: id,
      state: "queued",
      stage: null,
      at: created_at,
      ...fields,
    });
    const active = (await inject("GET", "/jobs/active")).json<{ jobId: string }[]>();
    expect(active.find((j) => j.jobId === id)).toMatchObject(fields);
  });

  test("a job whose request does not parse is still listed, without its request fields", async () => {
    const broken = queued();
    const blank = queued();
    db.query("UPDATE jobs SET params_json = '{' WHERE id = ?").run(broken);
    db.query("UPDATE jobs SET printer_id = NULL WHERE id = ?").run(blank);
    for (const id of [broken, blank]) {
      const one = (await inject("GET", `/jobs/${id}`)).json<unknown>();
      expect(one).toMatchObject({ jobId: id, state: "queued" });
      expect(one).not.toHaveProperty("profileId");
    }
    const active = (await inject("GET", "/jobs/active")).json<{ jobId: string }[]>();
    expect(active.map((j) => j.jobId)).toEqual(expect.arrayContaining([broken, blank]));
    expect(active.find((j) => j.jobId === broken)).not.toHaveProperty("printerId");
  });

  test("POST /jobs/:id/cancel answers 200, 202 or 404 by the job's state", async () => {
    const id = queued();
    expect((await inject("POST", `/jobs/${id}/cancel`)).json<unknown>()).toEqual({
      ok: true,
      jobId: id,
      state: "canceled",
    });
    const again = await inject("POST", `/jobs/${id}/cancel`);
    expect([again.statusCode, again.json().state]).toEqual([200, "canceled"]);
    const lease = claimed();
    const flying = await inject("POST", `/jobs/${lease.jobId}/cancel`);
    expect([flying.statusCode, flying.json().state]).toEqual([202, "canceling"]);
    const unknown = await inject("POST", "/jobs/nope/cancel");
    expect([unknown.statusCode, unknown.json().error]).toEqual([404, "unknown job"]);
  });
});

async function frames(url: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}${url}`);
  const states: string[] = [];
  ws.addEventListener("message", (e) => states.push(JSON.parse(String(e.data)).state));
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener("close", (e) => resolve(e.code), { once: true }),
  );
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return { states, closed };
}

describe("GET /jobs/:id/ws on the sqlite queue", () => {
  test("sends the snapshot, then every later event once, and closes after the terminal one", async () => {
    const lease = claimed();
    const { states, closed } = await frames(`/jobs/${lease.jobId}/ws`);
    writeStatus(db, lease, { state: "slicing", stage: "slicer" });
    writeStatus(db, lease, { state: "slicing", stage: "slicer", progress: 0.5 });
    await Bun.sleep(300);
    writeStatus(db, lease, { state: "failed", error: { stage: "slicer", reason: "boom" } });
    expect(await closed).toBe(1000);
    expect(states).toEqual(["generating", "slicing", "slicing", "failed"]);
  });

  test("a job already finished sends its snapshot and closes", async () => {
    const id = queued();
    db.query("UPDATE jobs SET state = 'done' WHERE id = ?").run(id);
    const { states, closed } = await frames(`/jobs/${id}/ws`);
    expect(await closed).toBe(1000);
    expect(states).toEqual(["done"]);
  });

  test("an unknown job closes with 4404 and no frame", async () => {
    const { states, closed } = await frames("/jobs/nope/ws");
    expect(await closed).toBe(4404);
    expect(states).toEqual([]);
  });
});
