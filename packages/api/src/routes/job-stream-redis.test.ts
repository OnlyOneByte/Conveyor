import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_QUEUE, jobChannel, jobSnapshotKey, publishStatus } from "@conveyor/shared";
import websocket from "@fastify/websocket";
import { Queue } from "bullmq";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { type BootedApi, bootApi, job } from "../../test/booted-api.ts";
import { createStatusHub } from "../status-hub.js";
import { registerJobStream } from "./job-stream.js";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis stream tests");

const VIEWERS = 5;

async function until(what: string, ms: number, ready: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + ms;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error(`${what} not within ${ms} ms`);
    await Bun.sleep(10);
  }
}

async function watching(ws: WebSocket) {
  const states: string[] = [];
  ws.addEventListener("message", (e) => states.push(JSON.parse(String(e.data)).state));
  const closed = new Promise<number>((resolve) =>
    ws.addEventListener("close", (e) => resolve(e.code), { once: true }),
  );
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  return { states, closed };
}

describe.skipIf(!url)("the job status stream on Redis", () => {
  let redis: Redis;
  let base = "";
  const app = Fastify();
  const name = `stream-test-${randomUUID()}`;
  const clients = async () =>
    String(await redis.client("LIST"))
      .split("\n")
      .filter((line) => line.includes(` name=${name} `)).length;

  beforeAll(async () => {
    redis = new Redis(url ?? "");
    const hub = createStatusHub(
      () => redis.duplicate({ connectionName: name, enableReadyCheck: false }),
      () => {},
    );
    await app.register(websocket);
    registerJobStream(app, {
      hub,
      snapshot: (id) => redis.get(jobSnapshotKey(id)),
      queued: async () => true,
    });
    base = (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws");
  });

  afterAll(async () => {
    app.server.closeAllConnections();
    await app.close();
    redis.disconnect();
  });

  async function viewer(jobId: string) {
    const ws = new WebSocket(`${base}/jobs/${jobId}/ws`);
    return watching(ws);
  }

  test(`${VIEWERS} viewers share one Redis connection, closed with 1000 on the terminal event`, async () => {
    const jobId = randomUUID();
    await publishStatus(redis, { jobId, state: "generating", at: 1 });
    const viewers: Awaited<ReturnType<typeof viewer>>[] = [];
    for (let i = 0; i < VIEWERS; i++) viewers.push(await viewer(jobId));
    await until("every viewer's snapshot", 5_000, () =>
      viewers.every((v) => v.states.length === 1),
    );
    expect(await clients()).toBe(1);
    await publishStatus(redis, { jobId, state: "done", at: 2 });
    expect(await Promise.all(viewers.map((v) => v.closed))).toEqual(Array(VIEWERS).fill(1000));
    for (const v of viewers) expect(v.states).toEqual(["generating", "done"]);
    await until("the shared subscriber to close", 5_000, async () => (await clients()) === 0);
  });

  test("the publish script never overwrites a terminal snapshot", async () => {
    const jobId = randomUUID();
    const watcher = redis.duplicate();
    const heard: string[] = [];
    watcher.on("message", (_channel, payload) => heard.push(JSON.parse(payload).state));
    await watcher.subscribe(`job:${jobId}:status`);
    expect(await publishStatus(redis, { jobId, state: "done", at: 1 })).toBe(true);
    expect(await publishStatus(redis, { jobId, state: "generating", at: 2 })).toBe(false);
    await redis.publish(jobChannel(jobId), JSON.stringify({ state: "sentinel" }));
    await until("the sentinel", 5_000, () => heard.includes("sentinel"));
    expect(JSON.parse((await redis.get(jobSnapshotKey(jobId))) ?? "{}")).toMatchObject({
      state: "done",
      seq: 1,
    });
    expect(heard).toEqual(["done", "sentinel"]);
    watcher.disconnect();
  });

  test("a job that finished before the socket opened gets its snapshot and 1000", async () => {
    const jobId = randomUUID();
    await publishStatus(redis, { jobId, state: "canceled", at: 1 });
    const late = await viewer(jobId);
    expect(await late.closed).toBe(1000);
    expect(late.states).toEqual(["canceled"]);
  });
});

describe.skipIf(!url)("the Redis job routes' stream wiring", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-stream-wiring-"));
  let api: BootedApi | undefined;
  let redis: Redis;
  let queue: Queue;
  const posted: string[] = [];

  beforeAll(async () => {
    redis = new Redis(url ?? "");
    queue = new Queue(JOB_QUEUE, {
      connection: new Redis(url ?? "", { maxRetriesPerRequest: null }),
    });
    api = await bootApi(dir, {
      REDIS_URL: url ?? "",
      CONVEYOR_QUEUE: "redis",
      CONVEYOR_AUTH: "disabled",
    });
  });

  afterAll(async () => {
    for (const id of posted) await (await queue.getJob(id))?.remove();
    await queue.close();
    redis.disconnect();
    await api?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const open = (jobId: string) =>
    watching(new WebSocket(`${api?.base.replace("http", "ws")}/jobs/${jobId}/ws`));

  test("streams from the job's snapshot key", async () => {
    const jobId = randomUUID();
    await publishStatus(redis, { jobId, state: "slicing", at: 1 });
    expect(JSON.parse((await redis.get(jobSnapshotKey(jobId))) ?? "{}").seq).toBe(1);
    const socket = await open(jobId);
    await until("the snapshot frame", 5_000, () => socket.states.length === 1);
    await publishStatus(redis, { jobId, state: "done", at: 2 });
    expect(await socket.closed).toBe(1000);
    expect(socket.states).toEqual(["slicing", "done"]);
  });

  test("waits on a job still in BullMQ and refuses one that is not", async () => {
    const res = await fetch(`${api?.base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    const { jobId } = (await res.json()) as { jobId: string };
    posted.push(jobId);
    const waiting = await open(jobId);
    const unknown = await open(randomUUID());
    expect(await unknown.closed).toBe(4404);
    await publishStatus(redis, { jobId, state: "canceled", at: 1 });
    expect(await waiting.closed).toBe(1000);
    expect(waiting.states).toEqual(["canceled"]);
  });

  test("GET /jobs/:id and cancel answer 404 for ids that are not job ids", async () => {
    const res = await fetch(`${api?.base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    const { jobId } = (await res.json()) as { jobId: string };
    posted.push(jobId);
    await publishStatus(redis, { jobId, state: "slicing", at: 1 });
    await redis.set(`job:${jobId}:cancel`, "1", "EX", 60);
    await redis.del("job:meta:cancel");
    const statuses = [];
    for (const id of [`${jobId}:seq`, `${jobId}:cancel`, "meta"]) {
      statuses.push((await fetch(`${api?.base}/jobs/${id}`)).status);
      statuses.push((await fetch(`${api?.base}/jobs/${id}/cancel`, { method: "POST" })).status);
    }
    expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
    expect(await redis.exists("job:meta:cancel")).toBe(0);
    expect((await fetch(`${api?.base}/jobs/${jobId}`)).status).toBe(200);
  });
});
