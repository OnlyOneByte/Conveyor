import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbRecordJob, dbRetriedBy, openDb } from "@conveyor/shared/db";
import { submitJob } from "./submit.js";

const dirs: string[] = [];
afterEach(() => {
  openDb(":memory:").close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

describe("submitJob on the Redis queue", () => {
  test("an enqueue that throws keeps the retry claim, since the job may have been stored anyway", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-submit-"));
    dirs.push(dir);
    const db = openDb(join(dir, "conveyor.db"));
    dbRecordJob(db, {
      id: "failed-1",
      generatorId: "gridfinity",
      printerId: "p",
      profileId: "q",
      state: "failed",
    });
    let queuedAs = "";
    const down = (jobId: string) => {
      queuedAs = jobId;
      return Promise.reject(new Error("redis reset the connection after storing it"));
    };
    await expect(submitJob(db, { request, retryOf: "failed-1" }, down)).rejects.toThrow(
      "redis reset the connection",
    );
    expect(dbRetriedBy(db, "failed-1")).toBe(queuedAs);
    expect(await submitJob(db, { request, retryOf: "failed-1" }, async () => {})).toEqual({
      code: 409,
      body: { error: "retryOf: job failed-1 was already retried", retriedBy: queuedAs },
    });
  });
});
