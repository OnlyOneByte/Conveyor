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
  enqueueRaw,
  jobDir,
  row,
  setup,
  start,
  uid,
  until,
} from "../test/helpers/loop-harness";
import { refusedJobId } from "./job-folder";

const STALE_LOG = "$ orca-slicer (the run before)\n[exited 0]\n";

beforeEach(setup);
afterEach(cleanup);

function requeueWithLeftovers(id: string): string {
  enqueue(id);
  claimJob(db, "dead");
  const workDir = jobDir(id);
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "plate_1.gcode"), "G28 ; the run before\n");
  writeFileSync(join(workDir, "model.gcode"), "G28 ; the run before\n");
  writeFileSync(join(workDir, "model.stl"), "solid before\n");
  writeFileSync(join(workDir, ENGINE_LOG), STALE_LOG);
  db.query("UPDATE jobs SET lease_until = 0 WHERE id = ?").run(uid(id));
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

const rawRow = (id: string) =>
  db.query<Record<string, unknown>, [string]>("SELECT * FROM jobs WHERE id = ?").get(id) ?? {};

const ANCHORED = "0b0c4b9e-5d33-4c52-9f3a-7f1c2a4e8d10/../conveyor.db";

for (const id of ["..", "", "conveyor.db", "secrets.key", "uploads", "x/../b", ANCHORED]) {
  test(`a job id of ${JSON.stringify(id)} fails at its first claim and touches no file`, async () => {
    const dataDir = join(dir, "data");
    mkdirSync(join(dataDir, "uploads"), { recursive: true });
    for (const name of ["keep.txt", "conveyor.db", "secrets.key", "b"]) {
      writeFileSync(join(dataDir, name), `${name}\n`);
    }
    writeFileSync(join(dir, "keep.txt"), "above the data dir\n");
    enqueueRaw(id);
    const { h } = start({}, { dataDir });
    await until(() => rawRow(id).state === "failed");
    expect(rawRow(id)).toMatchObject({ attempts: 1, lease_owner: null });
    expect(JSON.parse(String(rawRow(id).error_json))).toEqual({
      stage: "generator",
      reason: refusedJobId(id),
    });
    for (const name of ["keep.txt", "conveyor.db", "secrets.key", "b"]) {
      expect(readFileSync(join(dataDir, name), "utf8")).toBe(`${name}\n`);
    }
    expect(existsSync(join(dataDir, "uploads"))).toBe(true);
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
  const workDir = jobDir("c");
  mkdirSync(workDir, { recursive: true });
  writeFileSync(join(workDir, "model.gcode"), "G28 ; on the printer\n");
  db.query("UPDATE jobs SET state = 'slicing' WHERE id = ?").run(uid("c"));
  takePrinterSlot(db, lease);
  markSubmitted(db, lease, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
  releaseLease(db, lease);
  const { h } = start();
  await until(() => row("c").state === "done");
  expect(h.submits).toBe(0);
  expect(readFileSync(join(workDir, "model.gcode"), "utf8")).toBe("G28 ; on the printer\n");
});
