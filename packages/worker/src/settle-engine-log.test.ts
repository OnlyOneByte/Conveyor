import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StageCtx, StageError } from "@conveyor/shared";
import { ENGINE_LOG } from "@conveyor/shared/node";
import { cleanup, dir, enqueue, row, setup, start, until } from "../test/helpers/loop-harness";
import { harness } from "../test/helpers/pipeline-harness";

const LOG = "$ engine --run\n[exited 1]\n";

const failing = (stage: "generator" | "slicer") => async (ctx: StageCtx) => {
  await writeFile(join(ctx.workDir, "model.stl"), "solid x\n");
  await writeFile(join(ctx.workDir, ENGINE_LOG), LOG);
  throw new StageError(stage, `${stage} exited 1`);
};

const stageOpts = (stage: "generator" | "slicer") =>
  stage === "generator" ? { generate: failing(stage) } : { slice: failing(stage) };

const owned: string[] = [];

afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("redis mode: a failed job keeps only its engine log", () => {
  for (const stage of ["generator", "slicer"] as const) {
    test(`a ${stage} failure`, async () => {
      const workDir = await mkdtemp(join(tmpdir(), "conveyor-engine-log-"));
      owned.push(workDir);
      const h = harness({ ...stageOpts(stage), workDir });
      await expect(h.run()).rejects.toThrow(`${stage} exited 1`);
      expect(h.records[0].state).toBe("failed");
      expect(readdirSync(workDir)).toEqual([ENGINE_LOG]);
      expect(readFileSync(join(workDir, ENGINE_LOG), "utf8")).toBe(LOG);
    });
  }

  test("a failure before any engine ran still removes the whole folder", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "conveyor-engine-log-"));
    owned.push(workDir);
    const h = harness({
      workDir,
      generate: async () => {
        throw new StageError("generator", "bad params");
      },
    });
    await expect(h.run()).rejects.toThrow("bad params");
    expect(existsSync(workDir)).toBe(false);
  });

  test("a canceled job still removes its engine log", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "conveyor-engine-log-"));
    owned.push(workDir);
    let logged = false;
    const h = harness({
      workDir,
      cancelRequested: async () => logged,
      generate: async (ctx) => {
        await writeFile(join(ctx.workDir, ENGINE_LOG), LOG);
        logged = true;
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(h.generated).toBe(1);
    expect(existsSync(workDir)).toBe(false);
  });
});

describe("sqlite mode: a failed job keeps only its engine log", () => {
  beforeEach(setup);
  afterEach(cleanup);

  for (const stage of ["generator", "slicer"] as const) {
    test(`a ${stage} failure`, async () => {
      start(stageOpts(stage));
      enqueue(`j-${stage}`);
      await until(() => row(`j-${stage}`).state === "failed");
      const workDir = join(dir, `j-${stage}`);
      await until(() => !existsSync(join(workDir, "model.stl")));
      expect(row(`j-${stage}`).stage).toBe(stage);
      expect(readdirSync(workDir)).toEqual([ENGINE_LOG]);
      expect(readFileSync(join(workDir, ENGINE_LOG), "utf8")).toBe(LOG);
    });
  }
});
