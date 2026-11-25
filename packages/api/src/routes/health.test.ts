import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbWriteWorkerHeartbeat, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { redisPing, registerHealthRoutes } from "./health.js";

test("the SQLite queue has no Redis to ping", () => {
  expect(redisPing("sqlite")).toBeUndefined();
});

test("with the Redis queue the report pings the queue's Redis, within its deadline", async () => {
  const answering = async () => ({ redis: { ping: async () => "PONG" }, QUEUE_DEADLINE_MS: 50 });
  expect(await redisPing("redis", answering)?.()).toBe("PONG");
  const silent = async () => ({
    redis: { ping: () => new Promise<never>(() => {}) },
    QUEUE_DEADLINE_MS: 20,
  });
  await expect(redisPing("redis", silent)?.()).rejects.toThrow("queue gave no answer within 20 ms");
});

const dir = mkdtempSync(join(tmpdir(), "conveyor-health-route-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const db = () => openDb(join(dir, "conveyor.db"));

const deep = async (redis?: () => Promise<unknown>) => {
  const app = Fastify();
  registerHealthRoutes(app, redis, db);
  const res = await app.inject({ method: "GET", url: "/health/deep" });
  await app.close();
  return { status: res.statusCode, body: res.json() };
};

test("a fresh worker with engines reads ok, with redis when the queue uses it", async () => {
  dbWriteWorkerHeartbeat(db(), {
    at: Date.now(),
    engines: { openscad: "ok", orca: "ok", prusa: "missing" },
  });
  const res = await deep(async () => "PONG");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "ok", db: "ok", redis: "ok", worker: { state: "ok" } });
});

test("redis that doesn't answer makes the report down with a 503", async () => {
  const res = await deep(() => Promise.reject(new Error("redis://:hunter2@redis:6379 refused")));
  expect(res.status).toBe(503);
  expect(res.body).toMatchObject({ status: "down", redis: "down" });
  expect(JSON.stringify(res.body)).not.toContain("hunter2");
});

test("a database that can't be opened makes the report down", async () => {
  const app = Fastify();
  registerHealthRoutes(app, undefined, () => {
    throw new Error("unable to open database file");
  });
  const res = await app.inject({ method: "GET", url: "/health/deep" });
  await app.close();
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body)).toEqual({
    status: "down",
    db: "down",
    worker: { state: "missing" },
    engines: {},
  });
});
