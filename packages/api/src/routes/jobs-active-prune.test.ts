import { afterAll, beforeAll, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobSnapshotKey } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { closeQueue } from "../../test/helpers/close-queue.ts";
import { connection, redis } from "../queue.js";
import { registerJobRoutes } from "./jobs.js";

connection.disconnect();
redis.disconnect();

const dir = mkdtempSync(join(tmpdir(), "conveyor-active-prune-"));
const previous = process.env.DB_PATH;
const app = Fastify();
const failure = new Error("redis down");
let base = "";

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb();
  spyOn(redis, "smembers").mockImplementation(async () => ["finished"]);
  spyOn(redis, "mget").mockImplementation(async (...keys) =>
    keys
      .flat()
      .map((key) =>
        String(key) === jobSnapshotKey("finished")
          ? JSON.stringify({ jobId: "finished", state: "failed", at: 1 })
          : null,
      ),
  );
  spyOn(redis, "srem").mockImplementation(async () => {
    throw failure;
  });
  await registerJobRoutes(app);
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  try {
    app.server.closeAllConnections();
    await app.close();
    mock.restore();
    openDb().close();
    if (previous === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await closeQueue(process.env.REDIS_URL);
  }
});

test("a failed prune of settled jobs is logged with their ids, and the list still answers", async () => {
  const warn = spyOn(app.log, "warn");
  const res = await fetch(`${base}/jobs/active`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
  expect(warn).toHaveBeenCalledWith(
    { err: failure, jobIds: ["finished"] },
    "settled jobs not pruned from the active set",
  );
});
