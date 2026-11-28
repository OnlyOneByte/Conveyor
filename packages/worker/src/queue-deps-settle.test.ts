import { afterEach, describe, expect, test } from "bun:test";
import { PrintNotStartedError } from "@conveyor/shared";
import { requestCancel } from "@conveyor/shared/queue";
import { waitForAbort } from "../test/helpers/pipeline-harness";
import { cleanup, db, events, hold, queued, row } from "../test/helpers/queue-deps-harness";

afterEach(cleanup);

const stagesIn = (json: unknown) =>
  typeof json === "string" ? JSON.parse(json).map((t: { stage: string }) => t.stage) : json;

describe("a job settled on the sqlite queue", () => {
  test("a printer that refuses before the upload fails the job without a hold", async () => {
    const h = queued({
      submit: async () => {
        throw new PrintNotStartedError("printer is busy: tr reports it printing");
      },
    });
    await expect(h.run()).rejects.toThrow("printer is busy");
    expect(row()).toMatchObject({ state: "failed", submit_started_at: null, lease_owner: null });
    expect(JSON.parse(String(row().error_json))).toEqual({
      stage: "transport",
      reason: "printer is busy: tr reports it printing",
    });
    expect(hold()).toEqual({ hold_job_id: null, hold_reason: null });
    expect(h.submits).toBe(1);
  });

  test("a canceled print records no model or g-code path, since its files are removed", async () => {
    const h = queued({
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        requestCancel(db, "job-1");
        h.controller.abort();
        if (signal) await waitForAbort(signal);
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(row()).toMatchObject({ state: "canceled", model_path: null, gcode_path: null });
  });

  test("upload progress keeps the stage timings already written", async () => {
    let during: unknown;
    const h = queued({
      submit: async (ctx) => {
        ctx.reportUpload?.(512, 2048);
        await Bun.sleep(80);
        during = row().timings_json;
      },
    });
    expect(await h.run()).toBe("done");
    expect(events().some((e) => e.bytesTotal === 2048)).toBe(true);
    expect(stagesIn(during)).toEqual(["generator", "slicer", "transport"]);
  });

  test("waiting at the slot keeps the stage timings already written", async () => {
    let during: unknown;
    const h = queued({
      generate: async () => {
        db.query(
          "INSERT INTO jobs (id, generator_id, printer_id, profile_id, state, created_at, updated_at) VALUES ('other', 'gen', 'p1', 'prof', 'printing', 0, 0)",
        ).run();
      },
      slice: async () => {
        setTimeout(() => {
          during = row().timings_json;
          db.query("UPDATE jobs SET state = 'done' WHERE id = 'other'").run();
        }, 40);
      },
    });
    expect(await h.run()).toBe("done");
    expect(stagesIn(during)).toEqual(["generator", "slicer"]);
  });
});
