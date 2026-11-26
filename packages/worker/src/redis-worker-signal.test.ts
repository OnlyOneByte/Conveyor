import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dropsItsRedisKeys } from "../../shared/test/helpers/index.ts";

const url = process.env.REDIS_URL;
if (!url && process.env.CI)
  throw new Error("REDIS_URL must be set in CI for the Redis worker signal test");

const dir = mkdtempSync(join(tmpdir(), "conveyor-redis-worker-signal-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!url)("the worker entry point on the Redis queue, on SIGTERM (real Redis)", () => {
  test("exits 0 within 5 s of SIGTERM when no job is running", async () => {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "main.ts")], {
      cwd: dir,
      env: {
        ...process.env,
        CONVEYOR_QUEUE: "redis",
        REDIS_URL: url,
        DB_PATH: join(dir, "conveyor.db"),
        DATA_DIR: dir,
      },
      stdout: "pipe",
      stderr: "ignore",
    });
    try {
      const reader = proc.stdout.getReader();
      let seen = "";
      while (!seen.includes("conveyor worker ready")) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`worker exited before it was ready: ${seen}`);
        seen += new TextDecoder().decode(value);
      }
      const started = performance.now();
      proc.kill("SIGTERM");
      expect(await proc.exited).toBe(0);
      expect(performance.now() - started).toBeLessThan(5_000);
    } finally {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
  }, 15_000);
});

dropsItsRedisKeys();
