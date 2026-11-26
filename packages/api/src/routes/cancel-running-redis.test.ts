import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JOB_QUEUE } from "@conveyor/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { type BootedApi, bootApi, job } from "../../test/helpers/booted-api.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis cancel-while-running test");

const ISOLATED_DB = "13";
const WORKER = resolve(import.meta.dir, "../../../worker/src/main.ts");
const PROFILES = resolve(import.meta.dir, "../../../../profiles");

function isolated(base: string): string {
  const u = new URL(base);
  u.pathname = `/${ISOLATED_DB}`;
  return u.toString();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until<T>(what: string, ms: number, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(100);
  }
  throw new Error(`${what} not within ${ms} ms`);
}

describe.skipIf(!url)("cancelling a running job on the Redis queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-cancel-running-"));
  const marker = join(dir, "openscad.pid");
  const fakeOpenscad = join(dir, "fake-openscad");
  const scad = join(dir, "bins.scad");
  const redisUrl = isolated(url ?? "redis://127.0.0.1:6379");
  let api: BootedApi | undefined;
  let worker: ReturnType<typeof Bun.spawn> | undefined;

  beforeAll(async () => {
    writeFileSync(fakeOpenscad, `#!/bin/sh\necho $$ > "${marker}"\nexec sleep 60\n`);
    chmodSync(fakeOpenscad, 0o755);
    writeFileSync(scad, "cube(1);\n");
    const queue = new Queue(JOB_QUEUE, {
      connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    });
    await queue.obliterate({ force: true });
    await queue.close();
    api = await bootApi(dir, {
      REDIS_URL: redisUrl,
      CONVEYOR_QUEUE: "redis",
      CONVEYOR_AUTH: "disabled",
    });
    worker = Bun.spawn([process.execPath, WORKER], {
      cwd: dir,
      env: {
        ...process.env,
        CONVEYOR_ENGINE_STUB: "",
        REDIS_URL: redisUrl,
        DB_PATH: join(dir, "conveyor.db"),
        DATA_DIR: dir,
        CONVEYOR_PROFILES_ROOT: PROFILES,
        OPENSCAD_BIN: fakeOpenscad,
        GRIDFINITY_SCAD: scad,
        WORKER_CONCURRENCY: "1",
      },
      stdout: "ignore",
      stderr: "ignore",
    });
  });

  afterAll(async () => {
    worker?.kill();
    await worker?.exited;
    await api?.stop();
    if (existsSync(marker)) {
      const pid = Number(readFileSync(marker, "utf8"));
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
    const redis = new Redis(redisUrl);
    await redis.flushdb();
    redis.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  test("stops the engine and settles the job as canceled", async () => {
    const base = api?.base ?? "";
    const posted = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job),
    });
    expect(posted.status).toBe(202);
    const { jobId } = (await posted.json()) as { jobId: string };

    const pid = await until("the engine to start", 20_000, async () =>
      existsSync(marker) ? Number(readFileSync(marker, "utf8")) || undefined : undefined,
    );
    expect(alive(pid)).toBe(true);
    const running = (await (await fetch(`${base}/jobs/${jobId}`)).json()) as { state: string };
    expect(running.state).toBe("generating");

    const cancel = await fetch(`${base}/jobs/${jobId}/cancel`, { method: "POST" });
    const answer = { 200: "canceled", 202: "canceling" }[cancel.status];
    expect(answer).toBeDefined();
    expect(await cancel.json()).toEqual({ ok: true, jobId, state: answer });

    const settled = await until("the job to settle", 15_000, async () => {
      const res = await fetch(`${base}/jobs/${jobId}`);
      const body = (await res.json()) as { state: string };
      return body.state === "generating" ? undefined : body.state;
    });
    expect(settled).toBe("canceled");
    await until("the engine to exit", 5_000, async () => (alive(pid) ? undefined : true));
    const active = (await (await fetch(`${base}/jobs/active`)).json()) as { jobId: string }[];
    expect(active.map((evt) => evt.jobId)).not.toContain(jobId);
  }, 45_000);
});
