import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { enqueueJob } from "@conveyor/shared/queue";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { registerJobRoutes } from "./jobs-sqlite.js";
import { submitJob } from "./submit.js";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-retry-"));
const previousDbPath = process.env.DB_PATH;
const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};
let db: Database;
let app: FastifyInstance;
let n = 0;

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  db = openDb(process.env.DB_PATH);
  app = Fastify();
  await app.register(websocket);
  await registerJobRoutes(app, db);
});

afterAll(async () => {
  await app.close();
  db.close();
  if (previousDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previousDbPath;
  rmSync(dir, { recursive: true, force: true });
});

function job(state: "queued" | "failed"): string {
  const id = `retry-job-${++n}`;
  enqueueJob(db, { id, request });
  if (state === "failed") db.query("UPDATE jobs SET state = 'failed' WHERE id = ?").run(id);
  return id;
}

const submit = async (payload: Record<string, unknown>) => {
  const res = await app.inject({ method: "POST", url: "/jobs", payload });
  return {
    status: res.statusCode,
    body: z
      .looseObject({ jobId: z.string().optional(), error: z.string().optional() })
      .parse(res.json()),
  };
};
const needsYou = async () =>
  z
    .array(z.object({ id: z.string() }))
    .parse((await app.inject({ method: "GET", url: "/jobs/needs-you" })).json())
    .map((j) => j.id);
const count = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM jobs").get()?.n;

describe("retrying a failed job on the SQLite queue", () => {
  test("a retry takes its failure off the Needs-you list without a dismissal; a plain submit doesn't", async () => {
    const [failed, other] = [job("failed"), job("failed")];
    expect(await needsYou()).toEqual(expect.arrayContaining([failed, other]));
    expect((await submit(request)).status).toBe(202);
    expect(await needsYou()).toEqual(expect.arrayContaining([failed, other]));
    const retry = await submit({ ...request, retryOf: failed });
    expect(retry.status).toBe(202);
    expect(await needsYou()).not.toContain(failed);
    expect(await needsYou()).toContain(other);
    expect(db.query("SELECT dismissed_at, retried_by FROM jobs WHERE id = ?").get(failed)).toEqual({
      dismissed_at: null,
      retried_by: retry.body.jobId,
    });
  });

  test("refuses an unknown, unfailed or malformed retryOf with a 400 naming it, and queues nothing", async () => {
    const waiting = job("queued");
    const before = count();
    const answers = [];
    for (const retryOf of ["nope", waiting, 5, "", "x".repeat(201)])
      answers.push(await submit({ ...request, retryOf }));
    expect(answers.slice(0, 2)).toEqual([
      { status: 400, body: { error: "retryOf: unknown job nope" } },
      { status: 400, body: { error: `retryOf: job ${waiting} is queued, not failed` } },
    ]);
    expect(answers.slice(2).map((a) => [a.status, a.body.error])).toEqual([
      [400, "retryOf: Invalid input: expected string, received number"],
      [400, "retryOf: Too small: expected string to have >=1 characters"],
      [400, "retryOf: Too big: expected string to have <=200 characters"],
    ]);
    expect(count()).toBe(before);
  });

  test("of a double retry, sent in turn or at once, one is queued and the rest are 409s", async () => {
    const [one, two] = [job("failed"), job("failed")];
    const before = count() ?? 0;
    const inTurn = [];
    for (const _ of [1, 2]) inTurn.push(await submit({ ...request, retryOf: one }));
    const atOnce = await Promise.all([1, 2, 3].map(() => submit({ ...request, retryOf: two })));
    expect(inTurn.map((a) => a.status)).toEqual([202, 409]);
    expect(inTurn[1]?.body).toEqual({ error: `retryOf: job ${one} is already being retried` });
    expect(atOnce.map((a) => a.status).sort()).toEqual([202, 409, 409]);
    expect(count()).toBe(before + 2);
  });

  test("a retry whose queueing fails leaves the failure on the list to try again", async () => {
    const failed = job("failed");
    const down = () => Promise.reject(new Error("queue down"));
    await expect(submitJob(db, { request, retryOf: failed }, down)).rejects.toThrow("queue down");
    expect(await needsYou()).toContain(failed);
    expect((await submit({ ...request, retryOf: failed })).status).toBe(202);
  });
});
