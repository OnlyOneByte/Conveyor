import { describe, expect, test } from "bun:test";
import type { JobState } from "@conveyor/shared";
import {
  ACTIONS,
  BINS,
  beltSummary,
  COLLAPSE_AT,
  chipName,
  collapsedBelt,
  face,
  groupName,
  groupValues,
  groupVisible,
  IDLE,
  REOPEN_AT,
  shortName,
  status,
  type TrackJob,
  today,
  value,
} from "./track";

describe("chip text", () => {
  const job = (state: TrackJob["state"], progress?: number): TrackJob => ({
    id: state,
    name: "Gridfinity bin 2×3 · 6u",
    state,
    progress,
    printer: "Ender 3 V3",
  });

  test("shortens a Gridfinity name for the rail and keeps an upload's file name", () => {
    expect([shortName("Gridfinity bin 2×3 · 6u"), shortName("tray.stl")]).toEqual([
      "Bin 2×3 · 6u",
      "tray.stl",
    ]);
  });

  test("shows each state's value", () => {
    const states = [
      job("queued"),
      job("generating"),
      job("slicing", 0.35),
      job("transferring", 0.72),
      job("printing", 0.64),
    ];
    states.push(job("done"), job("failed"), job("canceled"));
    expect(states.map(value)).toEqual(["next", "modelling", "35%", "72%", "64%", "✓", "!", "×"]);
    expect(states.map(value)).not.toContain("…");
  });

  test("names start with the visible text, then the full name, printer and status", () => {
    expect(chipName(job("printing", 0.64))).toBe(
      "Bin 2×3 · 6u 64%, Gridfinity bin 2×3 · 6u on Ender 3 V3, printing",
    );
    expect(chipName({ id: "u", name: "tray.stl", state: "generating" })).toBe(
      "tray.stl making, tray.stl, modelling",
    );
    expect(face({ id: "u", name: "tray.stl", state: "generating" })).toBe("making");
    expect(face(job("printing", 0.64))).toBe("64%");
  });

  test("the focus card says what's happening and offers each state's one action", () => {
    expect([
      status(job("printing", 0.64)),
      status({ id: "u", name: "tray.stl", state: "queued" }),
    ]).toEqual(["printing on Ender 3 V3", "queued"]);
    const states: JobState[] = [
      "queued",
      "generating",
      "slicing",
      "transferring",
      "printing",
      "done",
      "failed",
      "canceled",
    ];
    expect(states.map((s) => ACTIONS[s])).toEqual([
      "Cancel",
      "Cancel",
      "Cancel",
      "Cancel",
      "Cancel",
      undefined,
      "Retry",
      "Print again",
    ]);
  });

  test("a group's name lists every member and its status after its visible text", () => {
    const members = [
      job("slicing", 0.35),
      { ...job("generating"), name: "Gridfinity bin 1×1 · 3u" },
      job("slicing", 0.12),
    ];
    expect(groupVisible(members)).toBe("3 jobs 35% · 12%");
    expect(groupName(members)).toBe(
      "3 jobs 35% · 12%: Bin 2×3 · 6u, slicing; Bin 1×1 · 3u, modelling; Bin 2×3 · 6u, slicing",
    );
  });

  test("a group with nothing measured yet shows only its count", () => {
    const waiting = [job("queued"), { ...job("generating"), name: "Gridfinity bin 1×1 · 3u" }];
    expect(groupValues(waiting)).toBe("");
    expect(groupVisible(waiting)).toBe("2 jobs");
    expect(groupName(waiting)).toBe("2 jobs: Bin 2×3 · 6u, queued; Bin 1×1 · 3u, modelling");
  });
});

describe("when the belt collapses to its 40 px bar", () => {
  test("on Make only past 80 px of scroll, on every other page always, and never while opened", () => {
    expect(COLLAPSE_AT).toBe(80);
    expect([
      collapsedBelt("/", 0, false),
      collapsedBelt("/", 80, false),
      collapsedBelt("/", 81, false),
    ]).toEqual([false, false, true]);
    expect([
      collapsedBelt("/history", 0, false),
      collapsedBelt("/jobs/a", 0, false),
      collapsedBelt("/settings", 0, true),
      collapsedBelt("/", 300, true),
    ]).toEqual([true, true, false, false]);
  });

  test("once collapsed on Make it stays collapsed until the page is back near the top, so the shrink can't flip it back", () => {
    expect(REOPEN_AT).toBe(4);
    expect([
      collapsedBelt("/", 11, false, true),
      collapsedBelt("/", 5, false, true),
      collapsedBelt("/", 4, false, true),
      collapsedBelt("/", 0, false, true),
    ]).toEqual([true, true, false, false]);
    expect([
      collapsedBelt("/", 79, false, false),
      collapsedBelt("/", 74, false, false),
      collapsedBelt("/", 300, true, true),
    ]).toEqual([false, false, false]);
  });
});

describe("the mobile belt's summary line", () => {
  const job = (id: string, state: JobState, extra: Partial<TrackJob> = {}): TrackJob => ({
    id,
    name: "Gridfinity Bin 2 × 3",
    state,
    ...extra,
  });
  test("counts waiting and moving jobs, and leads with the printing job's printer and percent", () => {
    expect(
      beltSummary([
        job("a", "queued"),
        job("b", "slicing"),
        job("c", "printing", { printer: "Ender 3 V3", progress: 0.64 }),
        job("d", "done"),
      ]),
    ).toBe("3 on the belt · Ender 64%");
    expect(beltSummary([job("a", "printing", { progress: 0.2 }), job("b", "queued")])).toBe(
      "2 on the belt · 20%",
    );
    expect([
      beltSummary([job("a", "queued")]),
      beltSummary([job("a", "failed"), job("b", "done")]),
    ]).toEqual(["1 on the belt", "Nothing on the rail"]);
    expect([IDLE, BINS, today(3)]).toEqual([
      "Nothing on the rail",
      { finished: "Finished", needs: "Needs you", waiting: "waiting" },
      "3 today",
    ]);
  });
});
