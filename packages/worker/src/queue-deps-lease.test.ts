import { afterEach, describe, expect, test } from "bun:test";
import { requestCancel } from "@conveyor/shared/queue";
import { waitForAbort } from "../test/helpers/pipeline-harness";
import { bumpToken, cleanup, db, queued, row } from "../test/helpers/queue-deps-harness";
import { LeaseLostError } from "./run";

afterEach(cleanup);

describe("a job run on the sqlite queue", () => {
  test("a slot the queue refuses never reaches submit()", async () => {
    const h = queued({
      slice: async () => {
        db.query("UPDATE jobs SET submit_started_at = 1 WHERE id = 'job-1'").run();
      },
    });
    await expect(h.run()).rejects.toThrow("printer slot refused");
    expect(h.submits).toBe(0);
  });

  test("a refused marker stops the run before it watches the print", async () => {
    let watched = false;
    const h = queued({
      submit: async () => void bumpToken(),
      status: async function* () {
        watched = true;
        yield { state: "done" };
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row().submitted_at).toBeNull();
    expect(watched).toBe(false);
  });

  test("a refused status write aborts the running engine", async () => {
    let first = "";
    const h = queued({
      generate: async () => void bumpToken(),
      slice: async (ctx) => {
        first = await Promise.race([
          waitForAbort(ctx.signal).catch(() => "aborted"),
          Bun.sleep(500).then(() => "still running"),
        ]);
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(first).toBe("aborted");
  });

  test("a refused terminal write is a lost lease, not done, and records nothing", async () => {
    const h = queued({
      status: async function* () {
        yield { state: "printing", progress: 0.5 };
        bumpToken();
        yield { state: "done" };
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row()).toMatchObject({ state: "printing", model_path: null });
  });

  test("a cancel that settleCancel refuses is a lost lease, not canceled", async () => {
    const h = queued({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        bumpToken();
        requestCancel(db, "job-1");
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row().state).toBe("printing");
  });

  test("progress still pending at a new state or at the marker is dropped, not flushed late", async () => {
    const h = queued({
      slice: async (ctx) => {
        ctx.report(0.4);
        ctx.report(0.8);
      },
      submit: async (ctx) => {
        await Bun.sleep(80);
        ctx.report(0.4);
        ctx.report(0.8);
      },
      status: async function* () {
        await Bun.sleep(120);
        yield { state: "printing", progress: 0.5 };
        yield { state: "done" };
      },
    });
    expect(await h.run()).toBe("done");
  });

  test("a lost lease stops the run without writing anything more", async () => {
    const h = queued({
      slice: async () => {
        db.query("UPDATE jobs SET lease_token = lease_token + 1 WHERE id = 'job-1'").run();
      },
    });
    await expect(h.run()).rejects.toBeInstanceOf(LeaseLostError);
    expect(row().state).toBe("slicing");
    expect(row()).toMatchObject({ submit_started_at: null, cancel_requested_at: null });
    expect(h.submits).toBe(0);
  });
});
