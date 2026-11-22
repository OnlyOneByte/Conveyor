import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "conveyor-api-secrets-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the api refuses to start on a malformed CONVEYOR_SECRETS_KEY without echoing it", () => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "index.ts")], {
    env: {
      ...process.env,
      CONVEYOR_AUTH: "disabled",
      CONVEYOR_SECRETS_KEY: "not-a-real-key-value",
      CONVEYOR_HOST: "127.0.0.1",
      PORT: "0",
      DB_PATH: join(dir, "conveyor.db"),
      DATA_DIR: dir,
      REDIS_URL: "redis://127.0.0.1:1",
    },
    timeout: 20_000,
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("[secrets] refusing to start: CONVEYOR_SECRETS_KEY");
  expect(result.stderr.toString()).not.toContain("not-a-real-key-value");
});
