import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StageError } from "@conveyor/shared";
import { ENGINE_LOG, requireOutput } from "@conveyor/shared/node";
import { DEFAULT_TIMING } from "@conveyor/shared/queue";
import {
  cleanup,
  db,
  enqueue,
  jobDir,
  logs,
  row,
  setup,
  start,
  uid,
  until,
} from "../test/helpers/loop-harness";
import { waitForAbort } from "../test/helpers/pipeline-harness";

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
  const aGenerating = gate();
  const bWrote = gate();
  const aSettled = gate();
  start(
    {
      generate: async () => {
        aGenerating.open();
        await bWrote.opened;
        throw new StageError("generator", "openscad exited 1");
      },
    },
    {
      concurrency: 1,
      tickMs: 1_000_000,
      reapMs: 1_000_000,
      timing: { ...DEFAULT_TIMING, leaseMs: 100 },
    },
  );
  await until(() => row("a").lease_owner === "w1");
  await aGenerating.opened;
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

test("a worker notices a taken lease on its next tick, not at its next renewal, and stops its engine", async () => {
  enqueue("a");
  const generating = gate();
  let stoppedAt = 0;
  start(
    {
      generate: async (ctx) => {
        generating.open();
        await waitForAbort(ctx.signal).catch(() => {
          stoppedAt = Date.now();
        });
      },
    },
    { renewEvery: 1_000_000 },
  );
  await generating.opened;
  const takenAt = Date.now();
  db.query("UPDATE jobs SET lease_token = lease_token + 1 WHERE id = ?").run(uid("a"));
  await until(() => stoppedAt > 0, 2000);
  expect(stoppedAt - takenAt).toBeLessThan(500);
  await until(() => logs.some((line) => line === `job ${uid("a")}: job lease lost`), 2000);
});

test("a lease read that fails is logged as a lease check, apart from the cancel check", async () => {
  enqueue("a");
  const generating = gate();
  const resume = gate();
  start({
    generate: async () => {
      generating.open();
      await resume.opened;
    },
  });
  await generating.opened;
  db.exec("ALTER TABLE jobs RENAME TO jobs_away");
  try {
    await until(
      () => logs.some((line) => line.startsWith(`job ${uid("a")}: lease check failed: `)),
      2000,
    );
    expect(logs.some((line) => line.startsWith(`job ${uid("a")}: cancel check failed: `))).toBe(
      true,
    );
  } finally {
    db.exec("ALTER TABLE jobs_away RENAME TO jobs");
    resume.open();
  }
  await until(() => row("a").state === "done", 3000);
});
