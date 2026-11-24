import { describe, expect, test } from "bun:test";
import type { Politeness } from "./announce";
import { BURST_MS, changes, createNewsDesk, type News } from "./belt-news";
import type { TrackJob } from "./track";

const job = (id: string, state: TrackJob["state"], extra: Partial<TrackJob> = {}): TrackJob => ({
  id,
  name: "Gridfinity bin 1×1 · 3u",
  state,
  printer: "Voron 2.4",
  ...extra,
});
const was = (...jobs: TrackJob[]) => new Map(jobs.map((j) => [j.id, j]));

describe("what the belt announces", () => {
  test("stage moves, starts, finishes and cancels are polite, with the printer and the start time", () => {
    const before = was(job("a", "slicing"), job("b", "transferring"), job("c", "printing"), job("d", "queued"), job("e", "generating"));
    const after = [job("a", "transferring"), job("b", "printing"), job("c", "done"), job("d", "canceled"), job("e", "slicing")];
    expect(changes(before, after, "14:05")).toEqual([
      { level: "polite", text: "Bin 1×1 · 3u moved to Send on Voron 2.4" },
      { level: "polite", text: "Bin 1×1 · 3u started printing on Voron 2.4 at 14:05" },
      { level: "polite", text: "Bin 1×1 · 3u finished on Voron 2.4" },
      { level: "polite", text: "Bin 1×1 · 3u was canceled" },
      { level: "polite", text: "Bin 1×1 · 3u moved to Slice on Voron 2.4" },
    ]);
  });

  test("a failure is assertive and gives its reason", () => {
    const after = [job("a", "failed", { reason: "the printer didn't answer" }), job("b", "failed", { printer: undefined }), job("c", "failed", { reason: "no answer within 10 s." })];
    expect(changes(was(job("a", "printing"), job("b", "slicing"), job("c", "printing")), after, "14:05")).toEqual([
      { level: "assertive", text: "Bin 1×1 · 3u failed: the printer didn't answer" },
      { level: "assertive", text: "Bin 1×1 · 3u failed" },
      { level: "assertive", text: "Bin 1×1 · 3u failed: no answer within 10 s" },
    ]);
  });

  test("percent changes, a move back to the queue, new jobs and jobs that left say nothing", () => {
    const before = was(job("a", "printing", { progress: 0.4 }), job("gone", "slicing"), job("back", "printing"));
    expect(changes(before, [job("a", "printing", { progress: 0.6 }), job("new", "slicing"), job("back", "queued")], "14:05")).toEqual([]);
  });
});

describe("the news desk", () => {
  const desk = () => {
    const said: [string, Politeness][] = [];
    const timers: (() => void)[] = [];
    const post = createNewsDesk((text, level) => said.push([text, level]), (run, ms) => ms === BURST_MS && timers.push(run));
    return { said, timers, post };
  };
  const polite = (text: string): News => ({ level: "polite", text });

  test("merges a burst within 2 s into one sentence per level", () => {
    expect(BURST_MS).toBe(2000);
    const { said, timers, post } = desk();
    post([polite("A moved to Send"), { level: "assertive", text: "B failed: out of filament" }]);
    post([polite("C finished"), { level: "assertive", text: "D failed" }]);
    expect([said, timers.length]).toEqual([[], 2]);
    for (const run of timers.splice(0)) run();
    expect(said).toEqual([
      ["A moved to Send; C finished.", "polite"],
      ["B failed: out of filament; D failed. Retry is on the job.", "assertive"],
    ]);
  });

  test("starts a new window after a burst is said, and says nothing for nothing", () => {
    const { said, timers, post } = desk();
    post([]);
    post([polite("A finished")]);
    timers.splice(0).forEach((run) => run());
    post([polite("B finished")]);
    timers.splice(0).forEach((run) => run());
    expect(said).toEqual([["A finished.", "polite"], ["B finished.", "polite"]]);
  });
});
