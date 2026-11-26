import { afterEach, describe, expect, test } from "bun:test";
import {
  claimJob,
  DEFAULT_TIMING,
  markSubmitted,
  releaseLease,
  requestCancel,
  takePrinterSlot,
} from "@conveyor/shared/queue";
import { cleanup, db, enqueue, row, setup, start, uid, until } from "../test/helpers/loop-harness";
import { waitForAbort } from "../test/helpers/pipeline-harness";

afterEach(cleanup);

describe("the sqlite queue worker", () => {
  test("caps engine work, and a job waiting at the printer slot does not count", async () => {
    setup();
    db.query(
      `INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, lease_owner, lease_until, created_at, updated_at)
       VALUES ('busy', 'gen', 'p1', 'prof', 'printing', 'other', ?, 0, 0)`,
    ).run(Date.now() + 20_000);
    enqueue("a", "p1");
    enqueue("b", "p2");
    let active = 0;
    let most = 0;
    start(
      {
        generate: async () => {
          most = Math.max(most, ++active);
          await Bun.sleep(30);
          active--;
        },
      },
      { concurrency: 1 },
    );
    await until(() => row("b").state === "done");
    expect(row("a")).toMatchObject({ state: "slicing", submit_started_at: null });
    expect(most).toBe(1);
    db.query("UPDATE jobs SET state = 'done' WHERE id = 'busy'").run();
    await until(() => row("a").state === "done");
  });

  test("reaps a job whose worker died and runs it again", async () => {
    setup();
    enqueue("a");
    claimJob(db, "dead");
    db.query(`UPDATE jobs SET lease_until = 0 WHERE id = '${uid("a")}'`).run();
    start({}, { timing: { ...DEFAULT_TIMING, backoffBaseMs: 0 } });
    await until(() => row("a").state === "done");
    expect(row("a").attempts).toBe(2);
  });

  test("claims a job enqueued after the worker went idle", async () => {
    setup();
    start();
    await Bun.sleep(50);
    enqueue("a");
    await until(() => row("a").state === "done");
  });

  test("a resumed print does not take an engine slot", async () => {
    setup();
    enqueue("a");
    const lease = claimJob(db, "gone")?.lease;
    if (!lease) throw new Error("not claimed");
    db.query(`UPDATE jobs SET state = 'slicing' WHERE id = '${uid("a")}'`).run();
    takePrinterSlot(db, lease);
    markSubmitted(db, lease, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
    releaseLease(db, lease);
    enqueue("b", "p2");
    start(
      {
        status: async function* (_handle, signal) {
          yield { state: "printing", progress: 0.1 };
          if (signal) await waitForAbort(signal);
        },
      },
      { concurrency: 1 },
    );
    await until(() => row("b").state === "printing");
    expect(row("a").state).toBe("printing");
  });

  test("resumes a job already on the printer without submitting it again", async () => {
    setup();
    enqueue("a");
    const lease = claimJob(db, "gone")?.lease;
    if (!lease) throw new Error("not claimed");
    db.query(`UPDATE jobs SET state = 'slicing' WHERE id = '${uid("a")}'`).run();
    takePrinterSlot(db, lease);
    markSubmitted(db, lease, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
    releaseLease(db, lease);
    const { h } = start();
    await until(() => row("a").state === "done");
    expect(h.submits).toBe(0);
  });

  test("prunes the events of long-settled jobs on a timer, and keeps recent ones", async () => {
    setup();
    start({}, { pruneMs: 20, retentionMs: 60_000 });
    enqueue("old");
    enqueue("recent");
    db.query(`UPDATE jobs SET state = 'done', updated_at = ? WHERE id = '${uid("old")}'`).run(
      Date.now() - 120_000,
    );
    db.query(`UPDATE jobs SET state = 'done', updated_at = ? WHERE id = '${uid("recent")}'`).run(
      Date.now(),
    );
    const events = (id: string) =>
      db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM job_events WHERE job_id = ?")
        .get(uid(id))?.n;
    await until(() => events("old") === 0);
    expect(events("recent")).toBe(1);
  });

  test("stop() clears the prune timer", async () => {
    setup();
    const { worker } = start({}, { pruneMs: 20, retentionMs: 60_000 });
    await worker.stop();
    enqueue("old");
    db.query(`UPDATE jobs SET state = 'done', updated_at = ? WHERE id = '${uid("old")}'`).run(
      Date.now() - 120_000,
    );
    await Bun.sleep(100);
    expect(
      db
        .query<{ n: number }, []>(
          `SELECT COUNT(*) AS n FROM job_events WHERE job_id = '${uid("old")}'`,
        )
        .get()?.n,
    ).toBe(1);
  });

  test("a cancel during a long engine run ends it within a tick", async () => {
    setup();
    enqueue("a");
    let running = false;
    start({
      generate: (ctx) => {
        running = true;
        return waitForAbort(ctx.signal);
      },
    });
    await until(() => running);
    requestCancel(db, uid("a"));
    await until(() => row("a").state === "canceled");
  });
});
