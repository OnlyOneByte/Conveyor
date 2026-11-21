import type { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { claimJob, enqueueJob, type Lease, tailEvents, writeStatus } from "@conveyor/shared/queue";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { DEFAULT_TAIL, registerJobRoutes, type TailOptions } from "./jobs-sqlite.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-stream-"));
const previousDbPath = process.env.DB_PATH;
process.env.DB_PATH = join(dir, "conveyor.db");
const db: Database = openDb(process.env.DB_PATH);
const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};
let app: FastifyInstance | undefined;
let reads = 0;
let n = 0;

afterEach(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  app = undefined;
  reads = 0;
});

afterAll(() => {
  db.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

async function serve(options: Partial<TailOptions>): Promise<string> {
  app = Fastify();
  await app.register(websocket);
  await registerJobRoutes(app, db, {
    ...DEFAULT_TAIL,
    read: (...args) => {
      reads++;
      return tailEvents(...args);
    },
    ...options,
  });
  return (await app.listen({ host: "127.0.0.1", port: 0 })).replace("http", "ws");
}

function claimed(): Lease {
  db.query(
    "UPDATE jobs SET state = 'done' WHERE state NOT IN ('done', 'failed', 'canceled')",
  ).run();
  const id = `job-${++n}`;
  enqueueJob(db, { id, request });
  const lease = claimJob(db, "w1")?.lease;
  if (lease?.jobId !== id) throw new Error("not claimed");
  return lease;
}

async function connect(url: string) {
  const ws = new WebSocket(url);
  const frames: unknown[] = [];
  let code = 0;
  ws.addEventListener("message", (e) => frames.push(JSON.parse(String(e.data))));
  const closed = new Promise<void>((resolve) =>
    ws.addEventListener("close", (e) => {
      code = e.code;
      resolve();
    }),
  );
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  return { ws, frames, closed, code: () => code };
}

describe("the sqlite job stream's limits", () => {
  test("polls fast while events arrive, then slows once idle", async () => {
    const base = await serve({ fastMs: 10, slowMs: 400, idleMs: 60 });
    const lease = claimed();
    await connect(`${base}/jobs/${lease.jobId}/ws`);
    await Bun.sleep(50);
    expect(reads).toBeGreaterThanOrEqual(3);
    await Bun.sleep(150);
    const before = reads;
    await Bun.sleep(300);
    expect(reads - before).toBeLessThanOrEqual(2);
  });

  test("stops polling once the client disconnects", async () => {
    const base = await serve({ fastMs: 10 });
    const lease = claimed();
    const socket = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await Bun.sleep(40);
    socket.ws.close();
    await socket.closed;
    await Bun.sleep(30);
    const after = reads;
    await Bun.sleep(100);
    expect(reads).toBe(after);
  });

  test("closes a socket at the end of its lifetime", async () => {
    const base = await serve({ fastMs: 10, lifetimeMs: 80 });
    const lease = claimed();
    const socket = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await socket.closed;
    expect(socket.frames).toHaveLength(1);
  });

  test("refuses a socket past the cap with 1013, and counts closed ones back", async () => {
    const base = await serve({ maxSockets: 1 });
    const lease = claimed();
    const first = await connect(`${base}/jobs/${lease.jobId}/ws`);
    const second = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await second.closed;
    expect([second.code(), second.frames]).toEqual([1013, []]);
    first.ws.close();
    await first.closed;
    await Bun.sleep(20);
    const third = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await Bun.sleep(50);
    expect(third.frames).toHaveLength(1);
  });

  test("drains a backlog longer than one page in a single tick", async () => {
    const base = await serve({ fastMs: 200, slowMs: 200 });
    const lease = claimed();
    const socket = await connect(`${base}/jobs/${lease.jobId}/ws`);
    for (let i = 1; i <= 150; i++) {
      writeStatus(db, lease, { state: "generating", stage: "generator", progress: i / 150 });
    }
    await Bun.sleep(300);
    expect(socket.frames).toHaveLength(151);
  });
});

describe("an unreadable job row", () => {
  test("is skipped by /jobs/active and closes its stream without a frame", async () => {
    const base = await serve({});
    const lease = claimed();
    const good = `job-${++n}`;
    enqueueJob(db, { id: good, request });
    db.query("UPDATE jobs SET error_json = 'not json' WHERE id = ?").run(lease.jobId);
    const active = await fetch(`${base.replace("ws", "http")}/jobs/active`);
    expect(active.status).toBe(200);
    const ids = ((await active.json()) as { jobId: string }[]).map((j) => j.jobId);
    expect(ids).toContain(good);
    expect(ids).not.toContain(lease.jobId);
    const socket = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await socket.closed;
    expect(socket.frames).toEqual([]);
  });
});
