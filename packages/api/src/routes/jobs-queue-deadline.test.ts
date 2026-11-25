import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobSnapshotKey } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerErrorReplies } from "../error-replies.js";
import { connection, jobQueue, QUEUE_DEADLINE_MS, redis } from "../queue.js";
import { registerCatalogRoutes } from "./catalog.js";
import { countLiveJobs, registerJobRoutes } from "./jobs.js";

connection.disconnect();
redis.disconnect();

const ANSWERS_WITHIN_MS = QUEUE_DEADLINE_MS * 2 + 1_000;
const dir = mkdtempSync(join(tmpdir(), "conveyor-queue-deadline-"));
const previous = process.env.DB_PATH;
const app = Fastify();
const jobId = randomUUID();
const snapshot = JSON.stringify({ jobId, state: "queued", at: 1 });
const never = () => new Promise<never>(() => undefined);

spyOn(jobQueue, "getJob").mockImplementation(never);
spyOn(jobQueue, "getJobs").mockImplementation(never);
spyOn(redis, "smembers").mockResolvedValue([jobId]);
spyOn(redis, "mget").mockResolvedValue([snapshot]);
spyOn(redis, "get").mockImplementation(async (key) =>
  String(key) === jobSnapshotKey(jobId) ? snapshot : null,
);

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb();
  registerErrorReplies(app);
  await app.register(websocket);
  await registerCatalogRoutes(app, countLiveJobs);
  await registerJobRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  mock.restore();
  openDb().close();
  if (previous === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous;
  rmSync(dir, { recursive: true, force: true });
});

async function timed(method: "GET" | "POST" | "DELETE", url: string) {
  const started = performance.now();
  const res = await app.inject({ method, url });
  return { status: res.statusCode, body: res.body, tookMs: performance.now() - started };
}

describe("job routes when the BullMQ queue never answers", () => {
  test(
    "GET /jobs/active answers within the deadline, without the queue's fields",
    async () => {
      const res = await timed("GET", "/jobs/active");
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual([{ jobId, state: "queued", at: 1 }]);
      expect(res.tookMs).toBeLessThan(ANSWERS_WITHIN_MS);
    },
    ANSWERS_WITHIN_MS * 2,
  );

  test(
    "GET /jobs/:id answers within the deadline with the bare snapshot",
    async () => {
      const res = await timed("GET", `/jobs/${jobId}`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ jobId, state: "queued", at: 1 });
      expect(res.tookMs).toBeLessThan(ANSWERS_WITHIN_MS);
    },
    ANSWERS_WITHIN_MS * 2,
  );

  test(
    "a cancel answers 503 within the deadline",
    async () => {
      const res = await timed("POST", `/jobs/${jobId}/cancel`);
      expect(res.status).toBe(503);
      expect(res.tookMs).toBeLessThan(ANSWERS_WITHIN_MS);
    },
    ANSWERS_WITHIN_MS * 2,
  );

  test(
    "deleting a printer answers 503 within the deadline and keeps the printer",
    async () => {
      const res = await timed("DELETE", "/catalog/printers/klipper-garage");
      expect(res.status).toBe(503);
      expect(res.tookMs).toBeLessThan(ANSWERS_WITHIN_MS);
      const printers = await app.inject({ method: "GET", url: "/catalog/printers" });
      expect(printers.body).toContain("klipper-garage");
    },
    ANSWERS_WITHIN_MS * 2,
  );
});
