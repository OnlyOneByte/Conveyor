import { afterEach, describe, expect, test } from "bun:test";
import { dbGetJob } from "@conveyor/shared/db";
import { cleanup, db, queued } from "../test/helpers/queue-deps-harness";
import { FILAMENT_NOT_READ } from "./pipeline";

afterEach(cleanup);

describe("a job's filament use on the sqlite queue", () => {
  test("records the filament the slicer output reports on the settled job", async () => {
    const read: string[] = [];
    const h = queued(
      {},
      {
        readFilament: async (path) => {
          read.push(path);
          return { grams: 3.08, metres: 1.032 };
        },
      },
    );
    expect(await h.run()).toBe("done");
    expect(read).toEqual(["/tmp/model.gcode"]);
    expect(dbGetJob(db, "job-1")?.filament).toEqual({ grams: 3.08, metres: 1.032 });
  });

  test("a filament read that fails is noted, and the job still finishes without it", async () => {
    const h = queued({}, { readFilament: async () => Promise.reject(new Error("EACCES")) });
    expect(await h.run()).toBe("done");
    expect(dbGetJob(db, "job-1")).toMatchObject({
      state: "done",
      notes: `${FILAMENT_NOT_READ}: EACCES`,
    });
    expect(dbGetJob(db, "job-1")?.filament).toBeUndefined();
  });
});
