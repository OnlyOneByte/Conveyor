import { describe, expect, test } from "bun:test";
import { dbGetJob, dbListJobs, dbRecordJob, openDb } from "./index";

const settled = { generatorId: "g", printerId: "p1", profileId: "prof", state: "done" as const };

describe("a settled job's filament use", () => {
  test("is stored and returned by history and detail, and absent when unknown", () => {
    const db = openDb(":memory:");
    dbRecordJob(db, { ...settled, id: "with", filament: { grams: 3.08, metres: 1.032 } });
    dbRecordJob(db, { ...settled, id: "without" });
    expect(dbGetJob(db, "with")?.filament).toEqual({ grams: 3.08, metres: 1.032 });
    expect(dbListJobs(db).find((job) => job.id === "with")?.filament).toEqual({
      grams: 3.08,
      metres: 1.032,
    });
    expect(dbGetJob(db, "without")?.filament).toBeUndefined();
  });

  test("reads a stored value it cannot parse as unknown", () => {
    const db = openDb(":memory:");
    dbRecordJob(db, { ...settled, id: "bad" });
    for (const stored of ["{", '{"grams":-1}', '{"metres":"far"}']) {
      db.query("UPDATE jobs SET filament_json = ? WHERE id = 'bad'").run(stored);
      expect(dbGetJob(db, "bad")?.filament).toBeUndefined();
    }
  });
});
