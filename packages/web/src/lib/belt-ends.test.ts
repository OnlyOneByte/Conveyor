import { describe, expect, spyOn, test } from "bun:test";
import type { Politeness } from "./announce";
import type { JobHistoryEntry } from "./api";
import { createEnds, ENDS_MS, type EndsFeed, http, midnight } from "./belt-ends";
import { BURST_MS, changes, createNewsDesk } from "./belt-news";
import type { Retried } from "./retry";
import type { TrackJob } from "./track";
import { createToasts } from "./ui/behaviour";

const NOW = new Date(2026, 10, 24, 15, 0);
const at = (hours: number) => new Date(2026, 10, 24, hours).getTime();
const request = { generator: { id: "gridfinity", params: { gridX: 2, gridY: 3 } }, printerId: "voron", profileId: "pla" };
const entry = (id: string, state: JobHistoryEntry["state"], updatedAt = at(9), extra: Partial<JobHistoryEntry> = {}): JobHistoryEntry => ({ id, request, state, createdAt: updatedAt, updatedAt, ...extra });
const catalog = {
  printers: [
    { id: "voron", name: "Voron 2.4", transportId: "klipper", address: "192.0.2.9", hasSecrets: false },
    { id: "prusa", name: "Prusa", transportId: "prusalink", address: "192.0.2.10", hasSecrets: false, allowedGenerators: ["passthrough"] },
    { id: "ender", name: "Ender 3", transportId: "klipper", address: "192.0.2.11", hasSecrets: false },
  ],
  generators: [{ id: "gridfinity", name: "Gridfinity Bin", outputs: [], paramSchema: { properties: { gridX: { type: "integer" }, gridY: { type: "integer" } } }, ui: { groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" as const }] } }],
};
const job: TrackJob = { id: "f1", name: "Gridfinity Bin 2×3", state: "failed", printer: "Voron 2.4" };

function rig(refuse: string[] = [], retried: Retried = { ok: true, jobId: "j2" }) {
  const calls: string[] = [];
  const said: [string, Politeness][] = [];
  const shown: [number, TrackJob[]][] = [];
  const toasts: { text: string; action?: { label: string; run: () => void } }[] = [];
  const picked: unknown[] = [];
  const upload = { ...request, generator: { id: "passthrough", params: { uploadId: "u1", filename: "clip.stl" } } };
  const records = new Map<string, JobHistoryEntry>();
  const call = (name: string) => async (arg?: unknown) => {
    calls.push(`${name} ${JSON.stringify(arg)}`);
    if (refuse.includes(name)) throw new Error("409");
  };
  const feed: EndsFeed = {
    finished: async (since) => (calls.push(`finished ${since}`), 4),
    needsYou: async () => [entry("f1", "failed", at(9), { error: { stage: "transport", reason: "the printer didn't answer" } })],
    entry: async (id) => records.get(id) ?? null,
    submit: call("submit"),
    retry: async (failed) => (await call("retry")(failed.id), retried),
    dismiss: call("dismiss"),
    cancel: call("cancel"),
    catalog: async () => catalog,
  };
  const ends = createEnds(feed, {
    show: (finished, needs) => shown.push([finished, needs]),
    toast: (text, action) => toasts.push(action ? { text, action } : { text }),
    say: (text, level) => said.push([text, level]),
    pick: (asked, retryOf) => picked.push([asked, retryOf]),
  }, () => NOW);
  return { calls, said, shown, toasts, picked, ends, records, upload };
}

describe("the belt's end states", () => {
  test("counts finishes since local midnight, and lists failures by name with their reason", async () => {
    const { calls, shown, ends } = rig();
    await ends.refresh();
    expect([ENDS_MS, calls]).toEqual([10000, [`finished ${at(0)}`]]);
    expect(midnight(new Date(2026, 10, 24, 0, 0))).toBe(at(0));
    expect(shown).toEqual([[4, [{ id: "f1", name: "Gridfinity Bin 2×3", state: "failed", printer: "Voron 2.4", reason: "the printer didn't answer" }]]]);
  });

  test("Retry hands the failed job to retryJob, says so, and refreshes the tray; a 409 says it's already being retried", async () => {
    const { calls, said, shown, ends } = rig();
    await ends.refresh();
    await ends.act(job, "Retry");
    expect([calls.filter((c) => !c.startsWith("finished")), said, shown.length]).toEqual([['retry "f1"'], [["Retrying Bin 2×3.", "polite"]], 2]);
    const taken = rig([], { ok: false, status: 409, error: "retryOf: job f1 is already being retried" });
    await taken.ends.refresh();
    await taken.ends.act(job, "Retry");
    expect([taken.said, taken.shown.length]).toEqual([[["Bin 2×3 is already being retried.", "polite"]], 2]);
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
    expect([calls, toasts.map((t) => [t.text, t.action?.label])]).toEqual([['cancel "c1"'], [["Bin 2×3 canceled", "Print again"]]]);
    toasts[0]?.action?.run();
    await Bun.sleep(0);
    expect([calls[1], said]).toEqual([`submit ${JSON.stringify(request)}`, [["Bin 2×3 is queued again.", "polite"]]]);
  });

  test("an upload's toast has no Print again; on click, a record that settled as failed wins over the chip's request", async () => {
    const { said, toasts, calls, ends, records, upload } = rig();
    await ends.act({ ...job, id: "u1", name: "clip.stl", state: "printing", request: upload }, "Cancel");
    await ends.act({ ...job, id: "u1", name: "clip.stl", state: "canceled", request: upload }, "Print again");
    records.set("c2", entry("c2", "failed"));
    await ends.act({ ...job, id: "c2", state: "canceled", request }, "Print again");
    expect([toasts, said, calls.some((c) => c.startsWith("submit"))]).toEqual([
      [{ text: "clip.stl canceled" }],
      [["Couldn't print clip.stl again.", "assertive"], ["Couldn't print Bin 2×3 again.", "assertive"]],
      false,
    ]);
  });

  test("the Finished count is the counts endpoint's done, since the given time", async () => {
    const seen: string[] = [];
    const reply = (body: unknown) => Object.assign(async (url: string | URL | Request) => (seen.push(String(url)), Response.json(body)), { preconnect: fetch.preconnect });
    const stub = spyOn(globalThis, "fetch").mockImplementation(reply({ done: 7, failed: 2, canceled: 1 }));
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
    expect([refused.said, refused.toasts, said]).toEqual([[["Couldn't cancel Bin 2×3.", "assertive"]], [], [["Couldn't print Bin 2×3 again.", "assertive"]]]);
  });
});

describe("a cancel from the belt", () => {
  function shell(refuse: string[] = []) {
    const said: string[] = [];
    const timers: (() => void)[] = [];
    const toasted = new Set<string>();
    const toasts = createToasts({ after: () => () => {}, now: () => 0 }, (text) => said.push(text));
    const cancel = async (id: string) => {
      if (refuse.includes(id)) throw new Error("409");
    };
    const feed = { finished: async () => 0, needsYou: async () => [], entry: async () => null, submit: async () => ({}), retry: async () => ({ ok: true as const, jobId: "x" }), dismiss: async () => ({}), cancel, catalog: async () => catalog };
    const ends = createEnds(feed, { show: () => {}, toast: (text, action) => toasts.show(text, action), say: (text) => said.push(text), pick: () => {} }, () => NOW, toasted);
    const desk = createNewsDesk((text) => said.push(text), (run, ms) => ms === BURST_MS && timers.push(run), toasted);
    const settle = (id: string) => {
      desk(changes(new Map([[id, { ...job, id, state: "printing" }]]), [{ ...job, id, state: "canceled" }], "14:05"));
      for (const run of timers.splice(0)) run();
    };
    return { said, ends, settle };
  }

  test("is announced once, by its toast, when the belt then sees the job canceled", async () => {
    const { said, ends, settle } = shell();
    await ends.act({ ...job, id: "c1", state: "printing", request }, "Cancel");
    settle("c1");
    expect(said).toEqual(["Bin 2×3 canceled"]);
  });

  test("leaves a cancel from elsewhere, or one that failed here, to the belt", async () => {
    const { said, ends, settle } = shell(["c2"]);
    settle("c9");
    await ends.act({ ...job, id: "c2", state: "printing", request }, "Cancel");
    settle("c2");
    expect(said).toEqual(["Bin 2×3 was canceled.", "Couldn't cancel Bin 2×3.", "Bin 2×3 was canceled."]);
  });
});
