import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";
import { type BootedApi, bootApi, job } from "../../test/booted-api.ts";
import { SOCKET_TIMEOUT_MS } from "../queue.js";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis restart test");

const ISOLATED_DB = 12;
const CYCLES = 3;
const SILENT_MS = 500;
const RECOVERS_WITHIN_MS = SOCKET_TIMEOUT_MS + 5_000;

interface RestartingRedis {
  port: number;
  restart(): void;
  close(): Promise<void>;
}

async function restartingRedis(target: URL): Promise<RestartingRedis> {
  const sockets = new Set<Socket>();
  let silent = false;
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };
  const server: Server = createServer((client) => {
    track(client);
    if (silent) return;
    const upstream = createConnection(Number(target.port), target.hostname);
    track(upstream);
    client.pipe(upstream).pipe(client);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("proxy has no port");
  return {
    port: address.port,
    restart: () => {
      silent = true;
      for (const socket of sockets) socket.destroy();
      setTimeout(() => (silent = false), SILENT_MS);
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

describe.skipIf(!url)("the api on the Redis queue across Redis restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-restart-"));
  const target = new URL(url ?? "redis://127.0.0.1:6379");
  let redis: RestartingRedis;
  let api: BootedApi;
  let admin: Redis;

  beforeAll(async () => {
    redis = await restartingRedis(target);
    admin = new Redis(`redis://${target.host}/${ISOLATED_DB}`);
    await admin.flushdb();
    api = await bootApi(dir, {
      CONVEYOR_AUTH: "disabled",
      REDIS_URL: `redis://127.0.0.1:${redis.port}/${ISOLATED_DB}`,
    });
  });

  afterAll(async () => {
    await api.stop();
    await redis.close();
    await admin.flushdb();
    admin.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  const submit = async () =>
    (
      await fetch(`${api.base}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(RECOVERS_WITHIN_MS),
      })
    ).status;

  async function untilAccepted(): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < RECOVERS_WITHIN_MS) {
      if ((await submit()) === 202) return Date.now() - started;
      await Bun.sleep(250);
    }
    throw new Error(`submits still refused ${RECOVERS_WITHIN_MS} ms after a Redis restart`);
  }

  test(
    `takes submits again after each of ${CYCLES} restarts, even when Redis accepts and then says nothing`,
    async () => {
      await untilAccepted();
      for (let cycle = 0; cycle < CYCLES; cycle++) {
        redis.restart();
        expect(await untilAccepted()).toBeLessThan(RECOVERS_WITHIN_MS);
      }
    },
    RECOVERS_WITHIN_MS * (CYCLES + 2),
  );
});
