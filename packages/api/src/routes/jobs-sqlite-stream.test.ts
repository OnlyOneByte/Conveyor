import type { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { claimJob, enqueueJob, type Lease, tailEvents, writeStatus } from "@conveyor/shared/queue";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { silentClient } from "../../test/helpers/silent-client.ts";
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

async function until(done: () => boolean) {
  for (let i = 0; i < 400 && !done(); i++) await Bun.sleep(5);
  if (!done()) throw new Error("condition not reached");
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
    let now = 0;
    const delays: number[] = [];
    let next = () => {};
    const base = await serve({
      fastMs: 10,
      slowMs: 400,
      idleMs: 60,
      now: () => now,
      schedule: (tick, ms) => {
        delays.push(ms);
        next = tick;
        return () => {};
      },
    });
    const lease = claimed();
    await connect(`${base}/jobs/${lease.jobId}/ws`);
    await until(() => delays.length === 1);
    now = 30;
    next();
    writeStatus(db, lease, { state: "slicing", stage: "slicer" });
    now = 50;
    next();
    now = 100;
    next();
    now = 111;
    next();
    expect(delays).toEqual([10, 10, 10, 10, 400]);
  });

  test("terminates a viewer that stops answering pings, and frees its slot", async () => {
    const base = await serve({ maxSockets: 1, heartbeat: { intervalMs: 10, missed: 1 } });
    const lease = claimed();
    const silent = await silentClient(base, `/jobs/${lease.jobId}/ws`);
    await silent.closed;
    let admitted = false;
    for (let i = 0; i < 50 && !admitted; i++) {
      const next = await connect(`${base}/jobs/${lease.jobId}/ws`);
      await until(() => next.frames.length > 0 || next.code() !== 0);
      admitted = next.code() === 0;
      if (!admitted) await Bun.sleep(10);
    }
    expect(admitted).toBe(true);
  });

  test("keeps a viewer that answers pings", async () => {
    const base = await serve({ heartbeat: { intervalMs: 10, missed: 25 } });
    const lease = claimed();
    const socket = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await Bun.sleep(400);
    expect([socket.ws.readyState, socket.code()]).toEqual([WebSocket.OPEN, 0]);
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

  test("counts a socket the server closes back once, not twice", async () => {
    const base = await serve({ maxSockets: 1 });
    const gone = await connect(`${base}/jobs/nope/ws`);
    await gone.closed;
    await Bun.sleep(20);
    const lease = claimed();
    const first = await connect(`${base}/jobs/${lease.jobId}/ws`);
    const second = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await second.closed;
    expect(second.code()).toBe(1013);
    expect(first.frames).toHaveLength(1);
  });

  test("closes the socket when a tail read throws", async () => {
    const base = await serve({
      fastMs: 10,
      read: () => {
        reads++;
        throw new Error("disk I/O error");
      },
    });
    const lease = claimed();
    const socket = await connect(`${base}/jobs/${lease.jobId}/ws`);
    await socket.closed;
    expect([socket.code(), socket.frames.length]).toEqual([1011, 1]);
    const after = reads;
    await Bun.sleep(50);
    expect(reads).toBe(after);
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
    expect([socket.code(), socket.frames]).toEqual([1011, []]);
  });
});
