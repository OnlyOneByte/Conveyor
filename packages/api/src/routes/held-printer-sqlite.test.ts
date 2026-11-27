import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { enqueueJob, holdPrinter, releasePrinterHold } from "@conveyor/shared/queue";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerJobRoutes } from "./jobs-sqlite.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-held-"));
const previousDbPath = process.env.DB_PATH;
const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};
let db: Database;
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  db = openDb(process.env.DB_PATH);
  app = Fastify();
  await app.register(websocket);
  await registerJobRoutes(app, db);
});

afterAll(async () => {
  await app.close();
  db.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

const hold = () =>
  holdPrinter(db, { printerId: request.printerId, jobId: "held-by", reason: "no answer", at: 1 });
const count = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM jobs").get()?.n;
const post = async (payload: Record<string, unknown>) => {
  const res = await app.inject({ method: "POST", url: "/jobs", payload });
  return { status: res.statusCode, body: res.json() };
};

describe("a held printer on the SQLite queue", () => {
  test("refuses a new job with a 409 that names the hold, and queues nothing", async () => {
    hold();
    const before = count();
    const { status, body } = await post(request);
    expect(status).toBe(409);
    expect(body.held).toBe(true);
    expect(body.error).toContain("is on hold");
    expect(body.error).toContain("Release hold on the Printers page");
    expect(count()).toBe(before);
    releasePrinterHold(db, request.printerId);
  });

  test("refuses a retry the same way, and leaves the failed job unclaimed", async () => {
    enqueueJob(db, { id: "held-failed", request });
    db.query("UPDATE jobs SET state = 'failed' WHERE id = ?").run("held-failed");
    hold();
    const before = count();
    const { status, body } = await post({ ...request, retryOf: "held-failed" });
    expect([status, body.held]).toEqual([409, true]);
    expect(count()).toBe(before);
    const row = db.query("SELECT retried_by FROM jobs WHERE id = ?").get("held-failed");
    expect(row).toEqual({ retried_by: null });
    releasePrinterHold(db, request.printerId);
  });

  test("once the hold is released, the same job is queued", async () => {
    hold();
    expect((await post(request)).status).toBe(409);
    releasePrinterHold(db, request.printerId);
    expect((await post(request)).status).toBe(202);
  });
});
