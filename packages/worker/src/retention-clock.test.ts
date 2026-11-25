import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupRoots,
  DAY,
  deps,
  jobDir,
  layout,
  memoryState,
  NOW,
  upload,
} from "../test/helpers/retention";
import { REAPER_CLOCK_STEP_MS, type Reaped, type RetentionDeps, reapOnce } from "./retention";

afterEach(cleanupRoots);

const HOUR = 60 * 60 * 1000;
const THIRTY = 30 * DAY;

function at(
  dirs: { dataDir: string; uploadDir: string },
  settled: Record<string, number>,
  now: number,
  state: RetentionDeps["state"],
  lines: string[] = [],
): RetentionDeps {
  return {
    ...deps(dirs, []),
    maxAgeMs: THIRTY,
    now: () => now,
    finishedBefore: (cutoff) => Object.keys(settled).filter((id) => (settled[id] ?? 0) < cutoff),
    state,
    log: (line: string) => lines.push(line),
  };
}

describe("the reaper clock", () => {
  test("the first run after an upgrade removes nothing; old items go 30 days after it", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const stale = upload(dirs.uploadDir, 400);
    const state = memoryState({});
    const settled = { [id]: NOW - 400 * DAY };
    const run = (now: number) => reapOnce(at(dirs, settled, now, state));
    expect(await run(NOW)).toEqual({ dirs: [], uploads: [] });
    expect(state.clock.startedAt).toBe(NOW);
    for (let t = NOW + HOUR; t < NOW + 29 * DAY; t += HOUR)
      expect(await run(t)).toEqual({ dirs: [], uploads: [] });
    expect(existsSync(join(dirs.dataDir, id))).toBe(true);
    let removed: Reaped = { dirs: [], uploads: [] };
    for (let t = NOW + 29 * DAY; t <= NOW + 31 * DAY && !removed.dirs.length; t += HOUR)
      removed = await run(t);
    expect(removed).toEqual({ dirs: [id], uploads: [stale] });
    expect(state.clock.startedAt).toBe(NOW);
  });

  test("a clock a month ahead only moves deletion forward 2 hours per run", async () => {
    const dirs = layout();
    const young = jobDir(dirs.dataDir);
    const edge = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW });
    const settled = { [young]: NOW - 20 * DAY, [edge]: NOW - THIRTY + HOUR };
    const reaped = await reapOnce(at(dirs, settled, NOW + THIRTY, state, lines));
    expect(reaped.dirs).toEqual([edge]);
    expect(existsSync(join(dirs.dataDir, young))).toBe(true);
    expect(state.clock.lastRunAt).toBe(NOW + REAPER_CLOCK_STEP_MS);
    expect(lines.join("\n")).toContain("moves at most 2 hours per run");
  });

  test("a clock behind the last run never moves the reaper clock back", async () => {
    const dirs = layout();
    const old = jobDir(dirs.dataDir);
    const recent = jobDir(dirs.dataDir);
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW });
    const settled = { [old]: NOW - THIRTY - HOUR, [recent]: NOW - 10 * DAY };
    expect((await reapOnce(at(dirs, settled, NOW - 5 * DAY, state))).dirs).toEqual([old]);
    expect(state.clock.lastRunAt).toBe(NOW);
    expect(existsSync(join(dirs.dataDir, recent))).toBe(true);
  });

  test("an outage only delays deletion", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW - 40 * DAY });
    const settled = { [id]: NOW - 35 * DAY };
    expect((await reapOnce(at(dirs, settled, NOW, state))).dirs).toEqual([]);
    expect(state.clock.lastRunAt).toBe(NOW - 40 * DAY + REAPER_CLOCK_STEP_MS);
    expect((await reapOnce(at(dirs, settled, NOW + HOUR, state))).dirs).toEqual([]);
    expect(existsSync(join(dirs.dataDir, id))).toBe(true);
  });

  test("an hourly run inside the window goes ahead, on real time", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW - HOUR });
    const settled = { [id]: NOW - 31 * DAY };
    expect((await reapOnce(at(dirs, settled, NOW, state, lines))).dirs).toEqual([id]);
    expect(state.clock.lastRunAt).toBe(NOW);
    expect(lines.join("\n")).not.toContain("moves at most");
  });
});
