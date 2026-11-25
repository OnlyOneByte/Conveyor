import { expect, test } from "bun:test";
import { BIN_GAP_PX, departures, hopDistance } from "./motion";
import type { TrackJob } from "./track";

const job = (id: string, state: TrackJob["state"]): TrackJob => ({ id, name: `Bin ${id}`, state });

test("a job that ended leaves from where its chip last sat, once; one that never had a chip doesn't", () => {
  const lefts = new Map([
    ["a", 120],
    ["b", 480],
  ]);
  const out = departures([job("a", "done"), job("c", "failed")], lefts);
  expect(out).toEqual([{ job: job("a", "done"), left: 120 }]);
  expect([...lefts.keys()]).toEqual(["b"]);
  expect(departures([job("a", "done")], lefts)).toEqual([]);
});

test("the hop runs from the chip past the rail's end into the bins", () => {
  expect(BIN_GAP_PX).toBe(24);
  expect(hopDistance(120, 900)).toBe(804);
  expect(hopDistance(950, 900)).toBe(24);
});
