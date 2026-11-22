import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { jobSnapshotKey, publishStatus } from "@conveyor/shared";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { Redis } from "ioredis";
import { createStatusHub } from "../status-hub.js";
import { registerJobStream } from "./job-stream.js";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis stream tests");

const VIEWERS = 5;

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
      () => redis.duplicate({ connectionName: name }),
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
    const states: string[] = [];
    ws.addEventListener("message", (e) => states.push(JSON.parse(String(e.data)).state));
    const closed = new Promise<number>((resolve) =>
      ws.addEventListener("close", (e) => resolve(e.code), { once: true }),
    );
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    return { states, closed };
  }

  test(`${VIEWERS} viewers share one Redis connection, closed with 1000 on the terminal event`, async () => {
    const jobId = `stream-${randomUUID()}`;
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
    const jobId = `stream-${randomUUID()}`;
    await publishStatus(redis, { jobId, state: "canceled", at: 1 });
    const late = await viewer(jobId);
    expect(await late.closed).toBe(1000);
    expect(late.states).toEqual(["canceled"]);
  });
});
