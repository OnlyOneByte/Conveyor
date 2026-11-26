import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dbReadWorkerHeartbeats, openDb } from "@conveyor/shared/db";
import { uploadSettings } from "@conveyor/shared/uploads";
import type { FastifyInstance } from "fastify";
import { healthReport } from "../health.js";
import { withinDeadline } from "../queue-reach.js";

interface QueueRedis {
  redis: { ping(): Promise<unknown> };
  QUEUE_DEADLINE_MS: number;
}

export const redisPing = (
  queue: string,
  load: () => Promise<QueueRedis> = () => import("../queue.js"),
): (() => Promise<unknown>) | undefined =>
  queue === "redis"
    ? async () => {
        const { redis, QUEUE_DEADLINE_MS } = await load();
        return withinDeadline(redis.ping(), QUEUE_DEADLINE_MS);
      }
    : undefined;

export const PROBE_LEFTOVER_MS = 60_000;

const PROBE = /^\.health-[0-9a-f-]{36}$/;

async function clearLeftoverProbes(dir: string, now: number): Promise<void> {
  for (const name of await readdir(dir)) {
    if (!PROBE.test(name)) continue;
    const path = join(dir, name);
    const stat = await lstat(path).catch(() => null);
    if (stat?.isFile() && stat.mtimeMs < now - PROBE_LEFTOVER_MS) await rm(path, { force: true });
  }
}

export async function uploadsWritable(dir: string, now: number = Date.now()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await clearLeftoverProbes(dir, now);
  const probe = join(dir, `.health-${randomUUID()}`);
  try {
    await writeFile(probe, "ok");
  } finally {
    await rm(probe, { force: true });
  }
}

export function registerHealthRoutes(
  app: FastifyInstance,
  redis?: () => Promise<unknown>,
  db: () => Database = () => openDb(),
  uploadsDir: string = uploadSettings(process.env).dir,
): void {
  app.get("/health/deep", async (req, reply) => {
    const now = Date.now();
    const report = await healthReport({
      db: () => db().query("SELECT 1").get(),
      redis,
      uploads: () => uploadsWritable(uploadsDir),
      heartbeats: () => dbReadWorkerHeartbeats(db(), now),
      now,
      onError: (check, err) => req.log.warn({ err }, `health: ${check} check failed`),
    });
    return reply.code(report.status === "down" ? 503 : 200).send(report);
  });
}
