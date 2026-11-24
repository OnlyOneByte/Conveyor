import { describe, expect, test } from "bun:test";
import type { JobState } from "@conveyor/shared";
import {
  centre,
  chipName,
  groupName,
  groupVisible,
  type Group,
  INSET,
  merge,
  onRail,
  type Placed,
  type RailState,
  SPANS,
  shortName,
  type TrackJob,
  value,
} from "./track";

const RAIL = 1000;
const W = 156;
const at = (id: string, state: RailState, progress: number): Placed => ({ id, x: centre(state, progress) * RAIL, width: W });
const ids = (groups: Group[]) => groups.map((g) => g.ids);
const pair = (gap: number, previous: Group[] = []) =>
  merge([{ id: "a", x: 400, width: W }, { id: "b", x: 400 + W + gap, width: W }], RAIL, previous);

describe("a chip's place on the rail", () => {
  test("is its stage's start plus progress across the stage, inset 2% from each tick", () => {
    expect(centre("slicing", 0)).toBeCloseTo(0.15 + INSET);
    expect(centre("slicing", 1)).toBeCloseTo(0.34 - INSET);
    expect(centre("printing", 0.5)).toBeCloseTo(0.49 + INSET + 0.5 * (0.51 - 2 * INSET));
    expect([centre("transferring", -1), centre("transferring", 2)]).toEqual([centre("transferring", 0), centre("transferring", 1)]);
  });

  test("stages tile the rail, Print takes half, and only rail states have a span", () => {
    expect(Object.values(SPANS)).toEqual([[0, 0.15], [0.15, 0.34], [0.34, 0.49], [0.49, 1]]);
    const states: JobState[] = ["queued", "generating", "slicing", "transferring", "printing", "done", "failed", "canceled"];
    expect(states.map(onRail)).toEqual([false, true, true, true, true, false, false, false]);
  });
});

describe("collision and merge", () => {
  test("0 and 1 jobs: nothing, then one chip at its place", () => {
    expect(merge([], RAIL)).toEqual([]);
    const one = at("p", "printing", 0.64);
    expect(merge([one], RAIL)).toEqual([{ ids: ["p"], x: one.x, width: W }]);
  });

  test("3 jobs: printing and slicing stay apart", () => {
    expect(ids(merge([at("p", "printing", 0.64), at("s", "slicing", 0.35)], RAIL))).toEqual([["s"], ["p"]]);
  });

  test("8 jobs: the modelling and slicing chips merge, the printing chip stays alone", () => {
    const chips = [at("m", "generating", 0.5), at("s", "slicing", 0.35), at("p", "printing", 0.64)];
    const groups = merge(chips, RAIL);
    expect(ids(groups)).toEqual([["m", "s"], ["p"]]);
    expect(groups[0]?.x).toBeCloseTo((Math.max(chips[0]?.x ?? 0, W / 2) + (chips[1]?.x ?? 0)) / 2);
  });

  test("20 jobs: three slicing chips form one group near Slice; Send and Print stay separate", () => {
    const chips = [at("s1", "slicing", 0.1), at("s2", "slicing", 0.4), at("s3", "slicing", 0.7), at("t", "transferring", 0.5), at("p", "printing", 0.3)];
    const groups = merge(chips, RAIL);
    expect(ids(groups)).toEqual([["s1", "s2", "s3"], ["t"], ["p"]]);
    expect((groups[0]?.x ?? 0) / RAIL).toBeGreaterThan(SPANS.slicing[0]);
    expect((groups[0]?.x ?? 0) / RAIL).toBeLessThan(SPANS.slicing[1]);
  });

  test("touching chips merge; a gap under 6 px joins, 6 px does not", () => {
    expect([ids(pair(0)), ids(pair(5.9)), ids(pair(6))]).toEqual([[["a", "b"]], [["a", "b"]], [["a"], ["b"]]]);
  });

  test("hysteresis: a merged pair only splits past 16 px; a pair that was apart needs under 6 px", () => {
    const merged: Group[] = [{ ids: ["a", "b"], x: 0, width: W }];
    expect([ids(pair(10, merged)), ids(pair(16, merged)), ids(pair(16.1, merged)), ids(pair(10))]).toEqual([
      [["a", "b"]],
      [["a", "b"]],
      [["a"], ["b"]],
      [["a"], ["b"]],
    ]);
  });

  test("clamps to both rail ends, and to the left edge on a rail narrower than a chip", () => {
    const groups = merge([{ id: "l", x: 10, width: W }, { id: "r", x: 995, width: W }], RAIL);
    expect(groups.map((g) => g.x)).toEqual([W / 2, RAIL - W / 2]);
    expect(merge([{ id: "n", x: 50, width: W }], 100)[0]?.x).toBe(W / 2);
  });

  test("clamps a chip before merging, so one pushed in from the rail end joins its neighbour", () => {
    expect(ids(merge([{ id: "m", x: 19, width: W }, { id: "s", x: 208, width: W }], RAIL))).toEqual([["m", "s"]]);
  });

  test("a wider group chip pushes the next chip out of the gap", () => {
    const chips = [{ id: "a", x: 300, width: W }, { id: "b", x: 380, width: W }, { id: "c", x: 560, width: W }];
    expect([ids(merge(chips, RAIL)), ids(merge(chips, RAIL, [], () => 340))]).toEqual([[["a", "b"], ["c"]], [["a", "b", "c"]]]);
  });

  test("sorts by x first, so input order doesn't matter", () => {
    expect(ids(merge([at("p", "printing", 0.9), at("m", "generating", 0)], RAIL))).toEqual([["m"], ["p"]]);
  });
});

describe("chip text", () => {
  const job = (state: TrackJob["state"], progress?: number): TrackJob => ({ id: state, name: "Gridfinity bin 2×3 · 6u", state, progress, printer: "Ender 3 V3" });

  test("shortens a Gridfinity name for the rail and keeps an upload's file name", () => {
    expect([shortName("Gridfinity bin 2×3 · 6u"), shortName("tray.stl")]).toEqual(["Bin 2×3 · 6u", "tray.stl"]);
  });

  test("shows each state's value", () => {
    const states = [job("queued"), job("generating"), job("slicing", 0.35), job("transferring", 0.72), job("printing", 0.64)];
    states.push(job("done"), job("failed"), job("canceled"));
    expect(states.map(value)).toEqual(["next", "…", "35%", "72%", "64%", "✓", "!", "×"]);
  });

  test("names start with the visible text, then the full name, printer and status", () => {
    expect(chipName(job("printing", 0.64))).toBe("Bin 2×3 · 6u 64%, Gridfinity bin 2×3 · 6u on Ender 3 V3, printing");
    expect(chipName({ id: "u", name: "tray.stl", state: "generating" })).toBe("tray.stl …, tray.stl, modelling");
  });

  test("a group's name lists every member and its status after its visible text", () => {
    const members = [job("slicing", 0.35), { ...job("generating"), name: "Gridfinity bin 1×1 · 3u" }, job("slicing", 0.12)];
    expect(groupVisible(members)).toBe("3 jobs 35% · … · 12%");
    expect(groupName(members)).toBe("3 jobs 35% · … · 12%: Bin 2×3 · 6u, slicing; Bin 1×1 · 3u, modelling; Bin 2×3 · 6u, slicing");
  });
});
