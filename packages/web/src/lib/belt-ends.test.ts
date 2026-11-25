import { describe, expect, spyOn, test } from "bun:test";
import { at, entry, job, request, rig } from "../../test/helpers/belt-ends";
import { ENDS_MS, http, midnight } from "./belt-ends";

describe("the belt's end states", () => {
  test("a counts poll that can't reach Conveyor says the belt is down until one answers again, keeping the last counts", async () => {
    const refuse: string[] = [];
    const { ends, shown, downs } = rig(refuse);
    await ends.refresh();
    refuse.push("finished");
    await ends.refresh();
    refuse.length = 0;
    await ends.refresh();
    expect(downs).toEqual([false, true, false]);
    expect(shown.map(([finished]) => finished)).toEqual([4, 4]);
  });

  test("a counts poll that answers with an error keeps the last counts and doesn't call the belt down", async () => {
    const refuse: string[] = [];
    const { ends, shown, downs } = rig(refuse);
    await ends.refresh();
    refuse.push("locked");
    expect(await ends.refresh()).toBe(false);
    expect(downs).toEqual([false, false]);
    expect(shown.map(([finished]) => finished)).toEqual([4]);
  });

  test("a refresh that can't read the counts keeps the last ones shown and says it didn't refresh", async () => {
    const up = rig();
    expect(await up.ends.refresh()).toBe(true);
    const down = rig(["finished"]);
    expect([await down.ends.refresh(), down.shown]).toEqual([false, []]);
  });

  test("counts finishes since local midnight, and lists failures by name with their reason", async () => {
    const { calls, shown, ends } = rig();
    await ends.refresh();
    expect([ENDS_MS, calls]).toEqual([10000, [`finished ${at(0)}`]]);
    expect(midnight(new Date(2026, 10, 24, 0, 0))).toBe(at(0));
    expect(shown).toEqual([
      [
        4,
        [
          {
            id: "f1",
            name: "Gridfinity Bin 2×3",
            state: "failed",
            printer: "Voron 2.4",
            reason: "the printer didn't answer",
          },
        ],
      ],
    ]);
  });

  test("Retry hands the failed job to retryJob, says so, and refreshes the tray; a 409 says it's already being retried", async () => {
    const { calls, said, shown, ends } = rig();
    await ends.refresh();
    await ends.act(job, "Retry");
    expect([calls.filter((c) => !c.startsWith("finished")), said, shown.length]).toEqual([
      ['retry "f1"'],
      [["Retrying Bin 2×3.", "polite"]],
      2,
    ]);
    const taken = rig([], { ok: false, status: 409, error: "retryOf: job f1 was already retried" });
    await taken.ends.refresh();
    await taken.ends.act(job, "Retry");
    expect([taken.said, taken.shown.length]).toEqual([
      [["Bin 2×3 is already being retried.", "polite"]],
      2,
    ]);
  });

  test("a refused retry is announced; Dismiss dismisses, and Pick printer hands over the request on another printer that takes it, with retryOf", async () => {
    const { calls, said, picked, ends } = rig([], { ok: false, status: 500, error: "down" });
    await ends.refresh();
    await ends.act(job, "Retry");
    await ends.act(job, "Dismiss");
    await ends.act(job, "Pick printer");
    expect(said).toEqual([["Couldn't retry Bin 2×3.", "assertive"]]);
    expect(calls.filter((c) => !c.startsWith("finished")).slice(1)).toEqual(['dismiss "f1"']);
    expect(picked).toEqual([[{ ...request, printerId: "ender", profileId: "" }, "f1"]]);
  });

  test("canceling a running job, which has no record yet, offers Print again from the chip's request, without retryOf", async () => {
    const { calls, said, toasts, ends } = rig();
    await ends.act({ ...job, id: "c1", state: "printing", request }, "Cancel");
    expect([calls, toasts.map((t) => [t.text, t.action?.label])]).toEqual([
      ['cancel "c1"'],
      [["Bin 2×3 canceled", "Print again"]],
    ]);
    toasts[0]?.action?.run();
    await Bun.sleep(0);
    expect([calls[1], said]).toEqual([
      `submit ${JSON.stringify(request)}`,
      [["Bin 2×3 is queued again.", "polite"]],
    ]);
  });

  test("an upload's toast has no Print again; on click, a record that settled as failed wins over the chip's request", async () => {
    const { said, toasts, calls, ends, records, upload } = rig();
    await ends.act(
      { ...job, id: "u1", name: "clip.stl", state: "printing", request: upload },
      "Cancel",
    );
    await ends.act(
      { ...job, id: "u1", name: "clip.stl", state: "canceled", request: upload },
      "Print again",
    );
    records.set("c2", entry("c2", "failed"));
    await ends.act({ ...job, id: "c2", state: "canceled", request }, "Print again");
    expect([toasts, said, calls.some((c) => c.startsWith("submit"))]).toEqual([
      [{ text: "clip.stl canceled" }],
      [
        ["Couldn't print clip.stl again.", "assertive"],
        ["Couldn't print Bin 2×3 again.", "assertive"],
      ],
      false,
    ]);
  });

  test("the Finished count is the counts endpoint's done, since the given time", async () => {
    const seen: string[] = [];
    const reply = (body: unknown) =>
      Object.assign(
        async (url: string | URL | Request) => {
          seen.push(String(url));
          return Response.json(body);
        },
        { preconnect: fetch.preconnect },
      );
    const stub = spyOn(globalThis, "fetch").mockImplementation(
      reply({ done: 7, failed: 2, canceled: 1 }),
    );
    const counted = [await http.finished(at(0))];
    stub.mockImplementation(reply({ failed: 2 }));
    counted.push(await http.finished(at(0)));
    stub.mockRestore();
    expect([counted, seen[0]]).toEqual([[7, 0], `/api/jobs-history/counts?since=${at(0)}`]);
  });

  test("a failed cancel, and Print again for a job that's gone, are announced", async () => {
    const refused = rig(["cancel"]);
    await refused.ends.act(job, "Cancel");
    const { said, ends } = rig();
    await ends.act({ ...job, id: "gone" }, "Print again");
    expect([refused.said, refused.toasts, said]).toEqual([
      [["Couldn't cancel Bin 2×3.", "assertive"]],
      [],
      [["Couldn't print Bin 2×3 again.", "assertive"]],
    ]);
  });
});
