import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbWriteWorkerHeartbeat, openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { PROBE_LEFTOVER_MS, redisPing, registerHealthRoutes, uploadsWritable } from "./health.js";

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

const uploads = join(dir, "uploads");

const deep = async (redis?: () => Promise<unknown>, uploadsDir = uploads) => {
  const app = Fastify();
  registerHealthRoutes(app, redis, db, uploadsDir);
  const res = await app.inject({ method: "GET", url: "/health/deep" });
  await app.close();
  return { status: res.statusCode, body: res.json() };
};

test("fresh workers with engines read ok, with redis when the queue uses it", async () => {
  for (const id of ["w1", "w2"])
    dbWriteWorkerHeartbeat(db(), id, {
      at: Date.now(),
      engines: { openscad: "ok", orca: "ok", prusa: "missing" },
    });
  const res = await deep(async () => "PONG");
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    status: "ok",
    says: "Conveyor is ready to print.",
    db: { state: "ok" },
    redis: { state: "ok" },
    uploads: { state: "ok" },
  });
  expect(res.body.workers.map((worker: { id: string }) => worker.id)).toEqual(["w1", "w2"]);
  expect(readdirSync(uploads)).toEqual([]);
});

test("an uploads folder the api can't write to reads as degraded, not ok", async () => {
  const blocked = join(dir, "not-a-folder");
  writeFileSync(blocked, "");
  const res = await deep(undefined, join(blocked, "uploads"));
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "degraded", uploads: { state: "down" } });
});

test("the uploads probe leaves nothing behind, even when the folder is new", async () => {
  const fresh = join(dir, "new", "uploads");
  await uploadsWritable(fresh);
  expect(readdirSync(fresh)).toEqual([]);
});

test("a probe a crash left behind is removed once over a minute old; nothing else is", async () => {
  const folder = join(dir, "leftovers");
  mkdirSync(folder, { recursive: true });
  const now = Date.now();
  const touch = (name: string, ageMs: number) =>
    utimesSync(join(folder, name), (now - ageMs) / 1000, (now - ageMs) / 1000);
  const file = (name: string, ageMs: number) => {
    writeFileSync(join(folder, name), "ok");
    touch(name, ageMs);
    return name;
  };
  const id = (n: number) => `${n}f2c9a8e-1b2c-4d5e-8f90-123456789abc`;
  file(`.health-${id(0)}`, PROBE_LEFTOVER_MS + 1_000);
  const kept = [
    file(`.health-${id(1)}`, PROBE_LEFTOVER_MS - 10_000),
    file(`${id(3)}.stl`, 10 * PROBE_LEFTOVER_MS),
    file(`.health-${id(4)}.keep`, 10 * PROBE_LEFTOVER_MS),
    file(`.health-${"-".repeat(36)}`, 10 * PROBE_LEFTOVER_MS),
    file(`.health-${id(5).replaceAll("-", "0")}`, 10 * PROBE_LEFTOVER_MS),
  ];
  mkdirSync(join(folder, `.health-${id(2)}`));
  touch(`.health-${id(2)}`, 10 * PROBE_LEFTOVER_MS);
  kept.push(`.health-${id(2)}`);
  await uploadsWritable(folder, now);
  expect(readdirSync(folder).sort()).toEqual(kept.sort());
});

test("redis that doesn't answer makes the report down with a 503", async () => {
  const res = await deep(() => Promise.reject(new Error("redis://:hunter2@redis:6379 refused")));
  expect(res.status).toBe(503);
  expect(res.body).toMatchObject({ status: "down", redis: { state: "down" } });
  expect(JSON.stringify(res.body)).not.toContain("hunter2");
});

test("a database that can't be opened makes the report down", async () => {
  const app = Fastify();
  registerHealthRoutes(
    app,
    undefined,
    () => {
      throw new Error("unable to open database file");
    },
    uploads,
  );
  const res = await app.inject({ method: "GET", url: "/health/deep" });
  await app.close();
  expect(res.statusCode).toBe(503);
  expect(JSON.parse(res.body)).toMatchObject({
    status: "down",
    says: "The job database didn't answer.",
    db: { state: "down" },
    workers: [],
  });
});
