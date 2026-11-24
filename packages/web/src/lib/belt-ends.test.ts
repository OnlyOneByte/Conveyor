import { describe, expect, test } from "bun:test";
import type { Politeness } from "./announce";
import type { JobHistoryEntry } from "./api";
import { createEnds, ENDS_MS, type EndsFeed, finishedToday } from "./belt-ends";
import type { Retried } from "./retry";
import type { TrackJob } from "./track";

const NOW = new Date(2026, 10, 24, 15, 0);
const at = (hours: number) => new Date(2026, 10, 24, hours).getTime();
const request = { generator: { id: "gridfinity", params: { gridX: 2, gridY: 3 } }, printerId: "voron", profileId: "pla" };
const entry = (id: string, state: JobHistoryEntry["state"], updatedAt = at(9), extra: Partial<JobHistoryEntry> = {}): JobHistoryEntry => ({ id, request, state, createdAt: updatedAt, updatedAt, ...extra });
const catalog = {
  printers: [{ id: "voron", name: "Voron 2.4", transportId: "klipper", address: "192.0.2.9", hasSecrets: false }],
  generators: [{ id: "gridfinity", name: "Gridfinity Bin", outputs: [], paramSchema: { properties: { gridX: { type: "integer" }, gridY: { type: "integer" } } }, ui: { groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" as const }] } }],
};
const job: TrackJob = { id: "f1", name: "Gridfinity Bin 2x3", state: "failed", printer: "Voron 2.4" };

function rig(refuse: string[] = [], retried: Retried = { ok: true, jobId: "j2" }) {
  const calls: string[] = [];
  const said: [string, Politeness][] = [];
  const shown: [number, TrackJob[]][] = [];
  const toasts: { text: string; label: string; run: () => void }[] = [];
  const picked: unknown[] = [];
  const records = new Map([["c1", entry("c1", "canceled")]]);
  const call = (name: string) => async (arg?: unknown) => {
    calls.push(`${name} ${JSON.stringify(arg)}`);
    if (refuse.includes(name)) throw new Error("409");
  };
  const feed: EndsFeed = {
    history: async () => [entry("d1", "done"), entry("d2", "done", at(-20)), entry("x", "failed")],
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
    toast: (text, action) => toasts.push({ text, ...action }),
    say: (text, level) => said.push([text, level]),
    pick: (asked) => picked.push(asked),
  }, () => NOW);
  return { calls, said, shown, toasts, picked, ends };
}

describe("the belt's end states", () => {
  test("counts today's finishes, and lists failures by name with their reason", async () => {
    expect([ENDS_MS, finishedToday([entry("a", "done"), entry("b", "done", at(-1)), entry("c", "canceled")], NOW)]).toEqual([10000, 1]);
    const { shown, ends } = rig();
    await ends.refresh();
    expect(shown).toEqual([[1, [{ id: "f1", name: "Gridfinity Bin 2x3", state: "failed", printer: "Voron 2.4", reason: "the printer didn't answer" }]]]);
  });

  test("Retry hands the failed job to retryJob, says so, and refreshes the tray; a 409 says it's already being retried", async () => {
    const { calls, said, shown, ends } = rig();
    await ends.refresh();
    await ends.act(job, "Retry");
    expect([calls, said, shown.length]).toEqual([['retry "f1"'], [["Retrying Bin 2x3.", "polite"]], 2]);
    const taken = rig([], { ok: false, status: 409, error: "retryOf: job f1 is already being retried" });
    await taken.ends.refresh();
    await taken.ends.act(job, "Retry");
    expect([taken.said, taken.shown.length]).toEqual([[["Bin 2x3 is already being retried.", "polite"]], 2]);
  });

  test("a refused retry is announced, and Dismiss and Pick printer do what they say", async () => {
    const { calls, said, picked, ends } = rig([], { ok: false, status: 500, error: "down" });
    await ends.refresh();
    await ends.act(job, "Retry");
    await ends.act(job, "Dismiss");
    await ends.act(job, "Pick printer");
    expect(said).toEqual([["Couldn't retry Bin 2x3.", "assertive"]]);
    expect(calls.slice(1)).toEqual(['dismiss "f1"']);
    expect(picked).toEqual([{ ...request, printerId: "", profileId: "" }]);
  });

  test("Cancel shows a Print again toast that sends the same request again, without retryOf", async () => {
    const { calls, said, toasts, ends } = rig();
    await ends.act({ ...job, id: "c1", state: "printing" }, "Cancel");
    expect([calls, toasts.map((t) => [t.text, t.label])]).toEqual([['cancel "c1"'], [["Bin 2x3 canceled", "Print again"]]]);
    toasts[0]?.run();
    await Bun.sleep(0);
    expect([calls[1], said]).toEqual([`submit ${JSON.stringify(request)}`, [["Bin 2x3 is queued again.", "polite"]]]);
  });

  test("a failed cancel, and Print again for a job that's gone, are announced", async () => {
    const refused = rig(["cancel"]);
    await refused.ends.act(job, "Cancel");
    const { said, ends } = rig();
    await ends.act({ ...job, id: "gone" }, "Print again");
    expect([refused.said, refused.toasts, said]).toEqual([[["Couldn't cancel Bin 2x3.", "assertive"]], [], [["Couldn't print Bin 2x3 again.", "assertive"]]]);
  });
});
