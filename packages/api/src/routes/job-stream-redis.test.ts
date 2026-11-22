import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_QUEUE, jobSnapshotKey, publishStatus } from "@conveyor/shared";
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
    const viewers = [];
    for (let i = 0; i < VIEWERS; i++) viewers.push(await viewer(jobId));
    await Bun.sleep(100);
    expect(await clients()).toBe(1);
    await publishStatus(redis, { jobId, state: "done", at: 2 });
    expect(await Promise.all(viewers.map((v) => v.closed))).toEqual(Array(VIEWERS).fill(1000));
    for (const v of viewers) expect(v.states).toEqual(["generating", "done"]);
    await Bun.sleep(100);
    expect(await clients()).toBe(0);
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
    await Bun.sleep(100);
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
});
