import { describe, expect, test } from "bun:test";
import type { JobState } from "../job";
import { dbRecordJob, dbTypicalStageMs, openDb } from "./index";

const STAGES = ["generator", "slicer", "transport"] as const;

function history() {
  const db = openDb(":memory:");
  db.exec("DELETE FROM jobs");
  let n = 0;
  const settle = (
    durations: Partial<Record<(typeof STAGES)[number], number>>,
    opts: { state?: JobState; generatorId?: string; printerId?: string } = {},
  ) => {
    const id = `j${++n}`;
    dbRecordJob(db, {
      id,
      generatorId: opts.generatorId ?? "gridfinity",
      printerId: opts.printerId ?? "p1",
      profileId: "prof",
      state: opts.state ?? "done",
      timings: STAGES.flatMap((stage, i) => {
        const durationMs = durations[stage];
        return durationMs === undefined ? [] : [{ stage, enteredAt: i, durationMs }];
      }),
    });
    db.query("UPDATE jobs SET updated_at = ? WHERE id = ?").run(n, id);
  };
  return { db, settle };
}

const pair = { generatorId: "gridfinity", printerId: "p1" };

describe("typical stage durations", () => {
  test("are the median of each stage over the pair's finished jobs", () => {
    const { db, settle } = history();
    settle({ generator: 10, slicer: 100, transport: 1_000 });
    settle({ generator: 30, slicer: 300 });
    settle({ generator: 20, slicer: 200, transport: 3_000 });
    settle({ generator: 40, slicer: 400, transport: 2_000 });
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 25, slicer: 250, transport: 2_000 });
  });

  test("leave out a stage with fewer than three samples", () => {
    const { db, settle } = history();
    settle({ generator: 10, transport: 1_000 });
    settle({ generator: 20, transport: 2_000 });
    settle({ generator: 30 });
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 20 });
    expect(dbTypicalStageMs(history().db, pair)).toEqual({});
  });

  test("count only finished jobs of the same generator and printer, newest first", () => {
    const { db, settle } = history();
    for (const ms of [900, 900, 900]) settle({ generator: ms });
    for (const ms of [10, 20, 30]) settle({ generator: ms });
    for (const state of ["failed", "canceled"] as const) settle({ generator: 5_000 }, { state });
    settle({ generator: 5_000 }, { generatorId: "other" });
    settle({ generator: 5_000 }, { printerId: "p2" });
    expect(dbTypicalStageMs(db, pair, 3)).toEqual({ generator: 20 });
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 465 });
  });

  test("skip timings it cannot read", () => {
    const { db, settle } = history();
    for (const ms of [10, 20, 30]) settle({ generator: ms });
    settle({});
    db.query("UPDATE jobs SET timings_json = '[{\"stage\":\"generator\"}]' WHERE id = 'j4'").run();
    settle({});
    db.query("UPDATE jobs SET timings_json = 'not json' WHERE id = 'j5'").run();
    expect(dbTypicalStageMs(db, pair)).toEqual({ generator: 20 });
  });
});
