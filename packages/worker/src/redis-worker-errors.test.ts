import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";
import { dropsItsRedisKeys } from "../../shared/test/helpers/index.ts";
import { startRedisWorker } from "./index";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis worker tests");

describe.skipIf(!url)("redis worker errors", () => {
  test("every Redis client and the BullMQ worker log errors instead of leaving them unhandled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-worker-errors-"));
    const clients: Redis[] = [];
    const env = { REDIS_URL: url, DB_PATH: join(dir, "conveyor.db"), DATA_DIR: dir };
    const running = startRedisWorker(env, {
      connect: (target, options) => {
        const client = new Redis(target, options ?? {});
        clients.push(client);
        return client;
      },
      makeDir: (path) => mkdir(path, { recursive: true }),
      queue: `test-worker-errors-${randomUUID()}`,
    });
    try {
      await running.worker.waitUntilReady();
      expect(clients.length).toBeGreaterThanOrEqual(2);
      for (const client of clients) expect(client.listenerCount("error")).toBeGreaterThan(0);
      expect(running.worker.listenerCount("error")).toBeGreaterThan(0);
    } finally {
      await running.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

dropsItsRedisKeys();
