import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StageCtx } from "@conveyor/shared";
import { ENGINE_LOG } from "@conveyor/shared/node";
import { harness } from "../test/helpers/pipeline-harness";
import { bumpToken, cleanup, queued } from "../test/helpers/queue-deps-harness";
import { LeaseLostError } from "./run";

const owned: string[] = [];

afterEach(async () => {
  for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true });
});

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "conveyor-lost-lease-"));
  owned.push(dir);
  return dir;
}

const filesOf = (ctx: StageCtx) =>
  Promise.all([
    writeFile(join(ctx.workDir, ENGINE_LOG), "$ openscad\n[exited 0]\n"),
    writeFile(join(ctx.workDir, "model.stl"), "solid next-owner\n"),
  ]);

test("sqlite: a run that loses its lease leaves the folder to the job's new owner", async () => {
  const dir = await workDir();
  const h = queued({
    workDir: dir,
    generate: async (ctx) => {
      await filesOf(ctx);
      bumpToken();
    },
  });
  try {
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(readdirSync(dir).sort()).toEqual([ENGINE_LOG, "model.stl"]);
  } finally {
    cleanup();
  }
});

test("redis: a run aborted for a lost lease leaves its folder in place", async () => {
  const dir = await workDir();
  const h = harness({
    workDir: dir,
    generate: async (ctx) => {
      await filesOf(ctx);
      h.controller.abort(new LeaseLostError());
    },
  });
  await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
  expect(readdirSync(dir).sort()).toEqual([ENGINE_LOG, "model.stl"]);
});

test("sqlite: an engine step's lease check fails the run as a lost lease once the job is taken", async () => {
  const dir = await workDir();
  let held: unknown = "unchecked";
  let taken: unknown = "unchecked";
  const outcome = (check?: () => void): unknown => {
    try {
      check?.();
      return check ? "held" : "no check";
    } catch (err) {
      return err;
    }
  };
  const h = queued({
    workDir: dir,
    generate: async (ctx) => {
      held = outcome(ctx.checkLease);
      bumpToken();
      taken = outcome(ctx.checkLease);
    },
  });
  try {
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(held).toBe("held");
    expect(taken).toBeInstanceOf(LeaseLostError);
  } finally {
    cleanup();
  }
});

test("redis: stages get no lease check", async () => {
  let check: unknown = "unset";
  const h = harness({
    generate: async (ctx) => {
      check = ctx.checkLease;
    },
  });
  expect(await h.run()).toBe("done");
  expect(check).toBeUndefined();
});
