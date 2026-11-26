import { afterEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_LOG } from "@conveyor/shared/node";
import { requestCancel } from "@conveyor/shared/queue";
import { waitForAbort } from "../test/helpers/pipeline-harness";
import { cleanup, db, queued, row } from "../test/helpers/queue-deps-harness";

const owned: string[] = [];

afterEach(async () => {
  cleanup();
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});

async function loggedWorkDir(): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "conveyor-engine-log-queue-"));
  owned.push(workDir);
  await writeFile(join(workDir, ENGINE_LOG), "$ orca-slicer\n[exited 0]\n");
  await writeFile(join(workDir, "model.gcode"), "G28\n");
  return workDir;
}

test("a failed resume keeps only the engine log", async () => {
  const workDir = await loggedWorkDir();
  const h = queued({ resume: true, workDir });
  db.query(
    `UPDATE jobs SET print_handle_json = '{"transportId":"gone","printerId":"p1","ref":"model.gcode"}' WHERE id = 'job-1'`,
  ).run();
  expect(await h.run()).toBe("failed");
  expect(readdirSync(workDir)).toEqual([ENGINE_LOG]);
});

test("a cancel whose stop the printer doesn't confirm fails and keeps only the engine log", async () => {
  const workDir = await loggedWorkDir();
  const h = queued({
    workDir,
    cancel: async () => {
      throw new Error("timeout");
    },
    status: async function* (_handle, signal) {
      yield { state: "printing", progress: 0.1 };
      h.controller.abort();
      if (signal) await waitForAbort(signal);
    },
  });
  expect(await h.run()).toBe("failed");
  expect(row().state).toBe("failed");
  expect(readdirSync(workDir)).toEqual([ENGINE_LOG]);
});

test("a cancel the printer confirms removes the whole folder, engine log included", async () => {
  const workDir = await loggedWorkDir();
  const h = queued({
    workDir,
    status: async function* (_handle, signal) {
      yield { state: "printing", progress: 0.1 };
      requestCancel(db, "job-1");
      h.controller.abort();
      if (signal) await waitForAbort(signal);
    },
  });
  expect(await h.run()).toBe("canceled");
  expect(h.cancels).toHaveLength(1);
  expect(existsSync(workDir)).toBe(false);
});
