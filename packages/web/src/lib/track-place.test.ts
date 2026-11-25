import { describe, expect, test } from "bun:test";
import { centre, MIN_CHIP_PX, placeGroups, type TrackJob } from "./track";

const RAIL = 1000;
const job = (id: string, state: TrackJob["state"], progress?: number): TrackJob => ({
  id,
  name: id,
  state,
  progress,
});

describe("placing jobs on the rail", () => {
  test("skips jobs off the rail and puts the rest at their stage position", () => {
    const groups = placeGroups([job("q", "queued"), job("p", "printing", 0.5)], RAIL, {}, {}, []);
    expect(groups).toEqual([{ ids: ["p"], x: centre("printing", 0.5) * RAIL, width: MIN_CHIP_PX }]);
  });

  test("uses a measured chip width, and a measured group width when chips merge", () => {
    const [one] = placeGroups([job("p", "printing", 0)], RAIL, { p: 200 }, {}, []);
    expect(one?.width).toBe(200);
    const merged = placeGroups(
      [job("a", "slicing", 0), job("b", "slicing", 0)],
      RAIL,
      {},
      { "a b": 300 },
      [],
    );
    expect(merged).toEqual([{ ids: ["a", "b"], x: centre("slicing", 0) * RAIL, width: 300 }]);
  });
});
