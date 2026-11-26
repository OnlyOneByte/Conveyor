import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StageError } from "@conveyor/shared";
import { ENGINE_LOG, requireOutput } from "@conveyor/shared/node";
import { DEFAULT_TIMING } from "@conveyor/shared/queue";
import {
  cleanup,
  enqueue,
  jobDir,
  logs,
  row,
  setup,
  start,
  uid,
  until,
} from "../test/helpers/loop-harness";

beforeEach(setup);
afterEach(cleanup);

function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

test("a stalled attempt whose engine fails after B reclaimed the job leaves B's files alone", async () => {
  enqueue("a");
  const bWrote = gate();
  const aSettled = gate();
  start(
    {
      generate: async () => {
        await bWrote.opened;
        throw new StageError("generator", "openscad exited 1");
      },
    },
    {
      concurrency: 1,
      renewEvery: 1_000_000,
      reapMs: 1_000_000,
      timing: { ...DEFAULT_TIMING, leaseMs: 100 },
    },
  );
  await until(() => row("a").lease_owner === "w1");
  let slicedFrom = "";
  const b = start(
    {
      generate: async (ctx) => {
        writeFileSync(join(ctx.workDir, "model.stl"), "solid B\n");
        writeFileSync(join(ctx.workDir, ENGINE_LOG), "$ openscad (B)\n[exited 0]\n");
        bWrote.open();
        await aSettled.opened;
      },
      slice: async (ctx) => {
        await requireOutput("slicer", join(ctx.workDir, "model.stl"), "B's model is gone");
        slicedFrom = readFileSync(join(ctx.workDir, "model.stl"), "utf8");
      },
    },
    { timing: { ...DEFAULT_TIMING, backoffBaseMs: 0 } },
  );
  await until(() => logs.some((line) => line === `job ${uid("a")}: job lease lost`), 5000);
  aSettled.open();
  await until(() => row("a").state === "done", 5000);
  expect(row("a")).toMatchObject({ attempts: 2, lease_owner: null });
  expect(slicedFrom).toBe("solid B\n");
  expect(readFileSync(join(jobDir("a"), "model.stl"), "utf8")).toBe("solid B\n");
  expect(readFileSync(join(jobDir("a"), ENGINE_LOG), "utf8")).toBe("$ openscad (B)\n[exited 0]\n");
  expect(b.h.submits).toBe(1);
});
