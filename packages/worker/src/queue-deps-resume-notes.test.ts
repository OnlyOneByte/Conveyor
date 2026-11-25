import { afterEach, describe, expect, test } from "bun:test";
import { type NoteKind, note, noteText } from "@conveyor/shared";
import { dbGetJob } from "@conveyor/shared/db";
import { cleanup, db, queued } from "../test/helpers/queue-deps-harness";

afterEach(cleanup);

describe("a failed resume writes a note of a known kind", () => {
  const cases: [string, NoteKind, string | undefined, () => ReturnType<typeof queued>][] = [
    [
      "the stored transport is unknown",
      "resumeUnknownTransport",
      "gone",
      () => {
        const h = queued({ resume: true });
        db.query(
          `UPDATE jobs SET print_handle_json = '{"transportId":"gone","printerId":"p1","ref":"model.gcode"}' WHERE id = 'job-1'`,
        ).run();
        return h;
      },
    ],
    [
      "the printer cannot be resolved",
      "resumeError",
      "unknown printer p1",
      () =>
        queued(
          { resume: true },
          {
            resolvePrinter: async () => {
              throw new Error("unknown printer p1");
            },
          },
        ),
    ],
    [
      "the first status read fails",
      "resumeError",
      "ECONNREFUSED",
      () =>
        queued({
          resume: true,
          status: async function* () {
            yield* [];
            throw new Error("ECONNREFUSED");
          },
        }),
    ],
    [
      "the status stream ends at once",
      "resumeConnectionLost",
      undefined,
      () => queued({ resume: true, status: async function* () {} }),
    ],
    [
      "the stored handle is unreadable",
      "resumeNoHandle",
      undefined,
      () => {
        const h = queued({ resume: true });
        db.query("UPDATE jobs SET print_handle_json = '{}' WHERE id = 'job-1'").run();
        return h;
      },
    ],
  ];

  for (const [name, kind, detail, setup] of cases) {
    test(`when ${name}`, async () => {
      expect(await setup().run()).toBe("failed");
      const notes = dbGetJob(db, "job-1")?.notes;
      expect(notes?.split("; ")[0]).toBe(noteText(note(kind, detail)));
    });
  }
});
