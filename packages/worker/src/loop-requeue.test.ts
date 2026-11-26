import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_LOG, requireOutput } from "@conveyor/shared/node";
import {
  claimJob,
  DEFAULT_TIMING,
  markSubmitted,
  releaseLease,
  takePrinterSlot,
} from "@conveyor/shared/queue";
import {
  cleanup,
  db,
  dir,
  enqueue,
  logs,
  row,
  setup,
  start,
  until,
} from "../test/helpers/loop-harness";

const STALE_LOG = "$ orca-slicer (the run before)\n[exited 0]\n";

beforeEach(setup);
afterEach(cleanup);

function requeueWithLeftovers(id: string): string {
  enqueue(id);
  claimJob(db, "dead");
  const workDir = join(dir, id);
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "plate_1.gcode"), "G28 ; the run before\n");
  writeFileSync(join(workDir, "model.gcode"), "G28 ; the run before\n");
  writeFileSync(join(workDir, "model.stl"), "solid before\n");
  writeFileSync(join(workDir, ENGINE_LOG), STALE_LOG);
  db.query("UPDATE jobs SET lease_until = 0 WHERE id = ?").run(id);
  return workDir;
}

const timing = { timing: { ...DEFAULT_TIMING, backoffBaseMs: 0 } };

test("a requeued job whose slicer writes nothing fails instead of printing the old g-code", async () => {
  const workDir = requeueWithLeftovers("a");
  let leftAtSlice: string[] = [];
  const { h } = start(
    {
      slice: async (ctx) => {
        leftAtSlice = readdirSync(ctx.workDir);
        await requireOutput(
          "slicer",
          join(ctx.workDir, "plate_1.gcode"),
          "orca-slicer exited 0 but wrote no G-code",
          "",
        );
      },
    },
    timing,
  );
  await until(() => row("a").state === "failed");
  expect(row("a").attempts).toBe(2);
  expect(JSON.parse(String(row("a").error_json))).toMatchObject({
    stage: "slicer",
    reason: expect.stringContaining("wrote no G-code"),
  });
  expect(h.submits).toBe(0);
  expect(leftAtSlice).not.toContain("model.stl");
  expect(leftAtSlice).not.toContain("model.gcode");
  expect(leftAtSlice).not.toContain("plate_1.gcode");
  expect(existsSync(join(workDir, "model.gcode"))).toBe(false);
  expect(existsSync(join(workDir, "plate_1.gcode"))).toBe(false);
});

for (const [name, id] of [
  ["..", ".."],
  ["an empty id", ""],
] as const) {
  test(`a job id of ${name} clears nothing and runs nothing`, async () => {
    const dataDir = join(dir, "data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "keep.txt"), "data dir\n");
    writeFileSync(join(dir, "keep.txt"), "above the data dir\n");
    enqueue(id);
    const { h } = start({}, { dataDir });
    await until(() => logs.some((line) => line.includes("names no folder in the data dir")));
    expect(readFileSync(join(dataDir, "keep.txt"), "utf8")).toBe("data dir\n");
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("above the data dir\n");
    expect(existsSync(join(dir, "conveyor.db"))).toBe(true);
    expect(h.generated).toBe(0);
  });
}

test("a requeued job starts its engine log afresh", async () => {
  const workDir = requeueWithLeftovers("b");
  start(
    {
      generate: async (ctx) => {
        writeFileSync(join(ctx.workDir, ENGINE_LOG), "$ openscad (this run)\n", { flag: "a" });
      },
    },
    timing,
  );
  await until(() => row("b").state === "done");
  expect(readFileSync(join(workDir, ENGINE_LOG), "utf8")).toBe("$ openscad (this run)\n");
});

test("a job resumed on the printer keeps the files its earlier run left", async () => {
  enqueue("c");
  const lease = claimJob(db, "gone")?.lease;
  if (!lease) throw new Error("not claimed");
  const workDir = join(dir, "c");
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "model.gcode"), "G28 ; on the printer\n");
  db.query("UPDATE jobs SET state = 'slicing' WHERE id = 'c'").run();
  takePrinterSlot(db, lease);
  markSubmitted(db, lease, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
  releaseLease(db, lease);
  const { h } = start();
  await until(() => row("c").state === "done");
  expect(h.submits).toBe(0);
  expect(readFileSync(join(workDir, "model.gcode"), "utf8")).toBe("G28 ; on the printer\n");
});
