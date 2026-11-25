import type { Database } from "bun:sqlite";
import { describe, expect, spyOn, test } from "bun:test";
import {
  dbCountJobs,
  dbListJobs,
  dbListNeedsYou,
  dbResolveJobTarget,
  dbTypicalStageMs,
  openDb,
} from "./index";

function plansOf(db: Database, run: () => unknown): string[] {
  const statements: string[] = [];
  const query = db.query.bind(db);
  const spy = spyOn(db, "query").mockImplementation((sql: string) => {
    statements.push(sql);
    return query(sql);
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return statements.map((sql) =>
    db
      .query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((row) => row.detail)
      .join(" | "),
  );
}

describe("the queries the belt polls", () => {
  const db = openDb(":memory:");
  const pair = { generatorId: "gridfinity", printerId: "p1" };

  test("typical durations read the pair's finished jobs from idx_jobs_typical, already sorted", () => {
    const [plan] = plansOf(db, () => dbTypicalStageMs(db, pair));
    expect(plan).toContain("USING INDEX idx_jobs_typical (generator_id=? AND printer_id=?)");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  test("Needs-you walks idx_jobs_needs_you in order instead of every job in the state", () => {
    const [plan] = plansOf(db, () => dbListNeedsYou(db));
    expect(plan).toContain("SCAN jobs USING INDEX idx_jobs_needs_you");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  test("a history page of failed jobs walks idx_jobs_history in order, with no sort of its own", () => {
    const [plan] = plansOf(db, () => dbListJobs(db, { limit: 50, state: "failed" }));
    expect(plan).toContain("SCAN jobs USING INDEX idx_jobs_history");
    expect(plan).not.toContain("TEMP B-TREE");
  });

  test("history counts since a time read the idx_jobs_history range", () => {
    const [plan] = plansOf(db, () => dbCountJobs(db, { since: 1, until: 2 }));
    expect(plan).toContain("USING INDEX idx_jobs_history (updated_at>? AND updated_at<?)");
  });

  test("history counts with no window are left to the planner, not forced onto idx_jobs_history", () => {
    for (const filter of [{}, { printerId: "p1" }]) {
      const [plan] = plansOf(db, () => dbCountJobs(db, filter));
      expect(plan).not.toContain("idx_jobs_history");
    }
  });

  test("a job target looks up its printer and profile by primary key", () => {
    const plans = plansOf(db, () => dbResolveJobTarget(db, "p1", "prof"));
    expect(plans).toEqual([
      expect.stringContaining("SEARCH printers USING INDEX sqlite_autoindex_printers_1 (id=?)"),
      expect.stringContaining("SEARCH profiles USING INDEX sqlite_autoindex_profiles_1 (id=?)"),
    ]);
  });
});
