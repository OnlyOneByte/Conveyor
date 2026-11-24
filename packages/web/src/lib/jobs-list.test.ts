import { describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import type { JobHistoryEntry } from "./api";
import type { Catalog } from "./catalog";
import { cancelRow, canCancel, DAY_MS, FILTERS, groupRows, historyPath, latest, liveRow, mergeSettled, PAGE, pillCount, retryRow, settledRow } from "./jobs-list";

const NOW = new Date(2026, 10, 24, 15, 0);
const now = NOW.getTime();
const catalog: Catalog = {
  printers: [{ id: "voron", name: "Voron 2.4", transportId: "klipper", address: "192.0.2.9", hasSecrets: false }],
  generators: [{ id: "gridfinity", name: "Gridfinity Bin", outputs: [], paramSchema: {}, ui: { groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" }, { title: "Height", fields: ["heightUnits"], layout: "stack" }], unitMm: { heightUnits: 7 } } }],
};
const generator = { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } };
const request = { generator, printerId: "voron", profileId: "pla" };
const view = (jobId: string, state: JobView["state"], extra: Partial<JobView> = {}): JobView => ({ jobId, state, at: now - 60_000, ...request, createdAt: now - 120_000, ...extra });
const entry = (id: string, state: JobHistoryEntry["state"], updatedAt: number, extra: Partial<JobHistoryEntry> = {}): JobHistoryEntry => ({ id, request, state, createdAt: updatedAt - 4_440_000, updatedAt, ...extra });

describe("the Jobs list", () => {
  test("a live row says its stage in words, with its percent while measured, its printer by name and when it was added", () => {
    expect(liveRow(view("a", "printing", { progress: 0.64 }), catalog, now)).toMatchObject({ id: "a", name: "Bin 2×3 · 6u", printer: "Voron 2.4", status: "printing, 64%", time: "added 2m ago", why: undefined, request });
    expect(liveRow(view("b", "queued"), catalog, now).status).toBe("waiting");
    expect(liveRow(view("c", "generating"), catalog, now).status).toBe("building the model");
    expect(liveRow(view("d", "transferring", { progress: 0.5, generator: undefined, printerId: undefined }), null, now)).toMatchObject({ name: "Job", printer: undefined, status: "sending, 50%", request: undefined });
  });

  test("a settled row says how it ended in plain words, and a failure leads with what to do", () => {
    expect(settledRow(entry("e", "done", now - 3_600_000), catalog, now)).toMatchObject({ status: "printed in 1 h 14 min", time: "1h ago", why: undefined });
    const failed = settledRow(entry("f", "failed", now - 60_000, { error: { stage: "transport", reason: "Unable to connect" } }), catalog, now);
    expect(failed).toMatchObject({ status: "failed at Send", why: "Conveyor couldn't reach the printer. Check that it's on and connected, then retry." });
    expect(settledRow(entry("g", "canceled", now), null, now)).toMatchObject({ status: "canceled", name: "Gridfinity", printer: undefined });
    const timed = entry("h", "done", now, { timings: [{ stage: "slicer", enteredAt: 0, durationMs: 41_000 }, { stage: "transport", enteredAt: 0, durationMs: 4_326_000 }] });
    expect(settledRow(timed, null, now).status).toBe("printed in 1 h 13 min");
  });

  test("Retry and Cancel say what happened, and only act on a row they fit", async () => {
    const failed = settledRow(entry("f", "failed", now), catalog, now);
    const sent: string[] = [];
    const ok = async ({ id }: { id: string }) => (sent.push(id), { ok: true as const, jobId: "n" });
    expect(await retryRow(failed, ok)).toEqual(["Retrying Bin 2×3 · 6u.", "polite"]);
    expect(await retryRow(failed, async () => ({ ok: false as const, status: 409, error: "x" }))).toEqual(["Bin 2×3 · 6u is already being retried.", "assertive"]);
    expect(await retryRow(failed, async () => ({ ok: false as const, status: 500, error: "x" }))).toEqual(["Couldn't retry Bin 2×3 · 6u.", "assertive"]);
    expect(await retryRow(settledRow(entry("d", "done", now), catalog, now), ok)).toEqual(["Only a failed job can be retried.", "polite"]);
    expect(await retryRow(undefined, ok)).toEqual(["Only a failed job can be retried.", "polite"]);
    expect(sent).toEqual(["f"]);
    const running = liveRow(view("a", "printing"), catalog, now);
    expect([canCancel(running), canCancel(failed), canCancel(liveRow(view("q", "queued"), catalog, now))]).toEqual([true, false, true]);
    expect(await cancelRow(running, async () => {})).toEqual(["Bin 2×3 · 6u canceled.", "polite"]);
    expect(await cancelRow(running, async () => Promise.reject(new Error("x")))).toEqual(["Couldn't cancel Bin 2×3 · 6u. Try again.", "assertive"]);
  });

  test("groups put the belt first, then Today, Yesterday and Earlier, drop empty groups and never show a job twice", () => {
    const live = [liveRow(view("a", "printing"), catalog, now)];
    const today = new Date(2026, 10, 24).getTime();
    const settled = [
      settledRow(entry("a", "done", now - 1000), catalog, now),
      settledRow(entry("t", "done", today), catalog, now),
      settledRow(entry("y", "failed", today - 1), catalog, now),
      settledRow(entry("y0", "done", today - DAY_MS), catalog, now),
      settledRow(entry("old", "canceled", today - DAY_MS - 1), catalog, now),
    ];
    expect(groupRows(live, settled, NOW).map((g) => [g.title, g.rows.map((r) => r.id)])).toEqual([
      ["On the belt", ["a"]],
      ["Today", ["t"]],
      ["Yesterday", ["y", "y0"]],
      ["Earlier", ["old"]],
    ]);
    expect(groupRows([], settled.slice(1, 2), NOW).map((g) => g.title)).toEqual(["Today"]);
  });

  test("pills count the belt live and the rest from the server, and say nothing until the counts arrive", () => {
    expect(FILTERS.map((f) => f.label)).toEqual(["All", "On the belt", "Printed", "Failed", "Canceled"]);
    const counts = { done: 5, failed: 2, canceled: 1 };
    expect(FILTERS.map((f) => pillCount(f.id, 3, counts))).toEqual([11, 3, 5, 2, 1]);
    expect(pillCount("all", 3, null)).toBeNull();
    expect(pillCount("live", 3, null)).toBe(3);
  });

  test("a later page merges in once per job, newest first, and pages ask the server by state and cursor", () => {
    const rows = (...pairs: [string, number][]) => pairs.map(([id, at]) => settledRow(entry(id, "done", at), null, now));
    expect(mergeSettled(rows(["b", 20], ["a", 10]), rows(["c", 30], ["b", 20])).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(PAGE).toBe(50);
    expect(historyPath("all", undefined)).toBe("/api/jobs-history?limit=50");
    const [last] = rows(["z", 123]);
    expect(historyPath("failed", last)).toBe("/api/jobs-history?limit=50&state=failed&before=123%3Az");
    expect(historyPath("done", undefined, 1000)).toBe("/api/jobs-history?limit=50&state=done&since=1000");
  });

  test("only the latest request's answer is kept, whatever order the answers arrive in", async () => {
    const req = latest();
    const deferred = <T>() => {
      let done: (value: T) => void = () => {};
      const promise = new Promise<T>((resolve) => (done = resolve));
      return { promise, done };
    };
    const failed = deferred<string>();
    const printed = deferred<string>();
    const first = req.keep(req.start(), failed.promise);
    const second = req.keep(req.start(), printed.promise);
    printed.done("printed rows");
    failed.done("failed rows");
    expect([await second, await first]).toEqual([{ value: "printed rows" }, null]);
    const poll = req.keep(req.now(), Promise.resolve("refresh"));
    expect(await poll).toEqual({ value: "refresh" });
  });
});
