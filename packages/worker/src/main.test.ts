import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "@conveyor/shared/db";
import { killGroup } from "@conveyor/shared/node";
import { enqueueJob } from "@conveyor/shared/queue";
import { startWorker } from "./main";
import { SLOT_WAIT_MESSAGE } from "./queue-deps";

const JOB = "0b0c4b9e-5d33-4c52-9f3a-7f1c2a4e8d10";

const MAIN = join(import.meta.dir, "main.ts");
const PROFILES = resolve(import.meta.dir, "../../../profiles");
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function workerEnv(extra: Record<string, string>): Record<string, string | undefined> {
  const { REDIS_URL: _redis, ...env } = process.env;
  return {
    ...env,
    CONVEYOR_QUEUE: "sqlite",
    CONVEYOR_QUEUE_UNSTABLE: "1",
    CONVEYOR_ENGINE_STUB: "1",
    CONVEYOR_PROFILES_ROOT: PROFILES,
    DB_PATH: join(dir, "conveyor.db"),
    DATA_DIR: dir,
    ...extra,
  };
}

function spawnMain(extra: Record<string, string> = {}) {
  return Bun.spawn([process.execPath, MAIN], {
    cwd: dir,
    env: workerEnv(extra),
    stdout: "ignore",
    stderr: "pipe",
  });
}

async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} not within ${ms} ms`)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

describe("the worker entry point on the sqlite queue", () => {
  test("starts a sqlite worker in process and stops it", async () => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-worker-main-"));
    const started = await startWorker(workerEnv({ WORKER_CONCURRENCY: "1" }));
    expect(started.mode).toBe("sqlite");
    await started.stop();
  });

  test("stop() waits for a SIGKILL still in its grace before it returns", async () => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-worker-main-"));
    const started = await startWorker(workerEnv({ WORKER_CONCURRENCY: "1" }));
    const sent: string[] = [];
    const how = {
      graceMs: 150,
      kill: (_pid: number, signal: string | 0) => void sent.push(String(signal)),
    };
    killGroup(
      4242,
      {
        jobId: "j",
        workDir: dir,
        signal: new AbortController().signal,
        report: () => {},
        log: () => {},
      },
      how,
    );
    await started.stop();
    expect(sent).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("exits 1 on a WORKER_CONCURRENCY that is not a positive integer", async () => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-worker-main-"));
    for (const raw of ["two", "0"]) {
      const proc = spawnMain({ WORKER_CONCURRENCY: raw });
      try {
        expect(await within(proc.exited, 10_000, "exit")).toBe(1);
        expect(await new Response(proc.stderr).text()).toContain("must be a positive integer");
      } finally {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
    }
  });

  test("exits 1 on a malformed MAX_UPLOAD_BYTES", async () => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-worker-main-"));
    const proc = spawnMain({ CONVEYOR_QUEUE: "redis", MAX_UPLOAD_BYTES: "abc" });
    try {
      expect(await within(proc.exited, 10_000, "exit")).toBe(1);
      expect(await new Response(proc.stderr).text()).toContain("MAX_UPLOAD_BYTES must be");
    } finally {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
  });

  test("exits 1 on a malformed CONVEYOR_SECRETS_KEY", async () => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-worker-main-"));
    const proc = spawnMain({ CONVEYOR_QUEUE: "redis", CONVEYOR_SECRETS_KEY: "short" });
    try {
      expect(await within(proc.exited, 10_000, "exit")).toBe(1);
      expect(await new Response(proc.stderr).text()).toContain("[secrets] refusing to start");
    } finally {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
  });

  test("SIGTERM requeues a job waiting at the printer slot and exits 0", async () => {
    dir = mkdtempSync(join(tmpdir(), "conveyor-worker-main-"));
    const db = openDb(join(dir, "conveyor.db"));
    db.query(
      `INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, lease_owner, lease_until, created_at, updated_at)
       VALUES ('busy', 'gridfinity', 'klipper-garage', 'prusa/klipper-pla-0.2', 'printing', 'other', ?, 0, 0)`,
    ).run(Date.now() + 25_000);
    enqueueJob(db, {
      id: JOB,
      request: {
        generator: { id: "gridfinity", params: {} },
        printerId: "klipper-garage",
        profileId: "prusa/klipper-pla-0.2",
      },
    });
    const row = () =>
      db.query<Record<string, unknown>, []>(`SELECT * FROM jobs WHERE id = '${JOB}'`).get() ?? {};
    const proc = spawnMain({ WORKER_CONCURRENCY: "1" });
    try {
      const deadline = Date.now() + 15_000;
      while (row().message !== SLOT_WAIT_MESSAGE) {
        if (proc.exitCode !== null || Date.now() > deadline) {
          throw new Error(`job never reached the slot: ${JSON.stringify(row())}`);
        }
        await Bun.sleep(20);
      }
      proc.kill("SIGTERM");
      expect(await within(proc.exited, 10_000, "exit after SIGTERM")).toBe(0);
      expect(row()).toMatchObject({ state: "queued", attempts: 0, lease_owner: null });
      expect(
        db.query("SELECT hold_job_id FROM printers WHERE id = 'klipper-garage'").get(),
      ).toEqual({ hold_job_id: null });
    } finally {
      if (proc.exitCode === null) proc.kill("SIGKILL");
      await proc.exited;
      db.close();
    }
  });
});
