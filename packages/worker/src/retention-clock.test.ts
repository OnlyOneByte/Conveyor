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
import {
  type ProcessClock,
  processClock,
  type Reaped,
  type RetentionDeps,
  reapOnce,
} from "./retention";

afterEach(cleanupRoots);

const HOUR = 60 * 60 * 1000;
const THIRTY = 30 * DAY;

function fakeProcess(): ProcessClock & { advance: (ms: number) => void } {
  let uptime = 0;
  const clock = processClock(() => uptime);
  return Object.assign(clock, {
    advance: (ms: number) => {
      uptime += ms;
    },
  });
}

function at(
  dirs: { dataDir: string; uploadDir: string },
  settled: Record<string, number>,
  now: number,
  state: RetentionDeps["state"],
  process: ProcessClock,
  lines: string[] = [],
): RetentionDeps {
  return {
    ...deps(dirs, []),
    maxAgeMs: THIRTY,
    now: () => now,
    finishedBefore: (cutoff) => Object.keys(settled).filter((id) => (settled[id] ?? 0) < cutoff),
    state,
    process,
    log: (line: string) => lines.push(line),
  };
}

describe("the reaper clock", () => {
  test("the first run after an upgrade removes nothing; old items go 30 days of uptime after it", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const stale = upload(dirs.uploadDir, 400);
    const state = memoryState({});
    const process = fakeProcess();
    const settled = { [id]: NOW - 400 * DAY };
    const run = (elapsed: number) => reapOnce(at(dirs, settled, NOW + elapsed, state, process));
    expect(await run(0)).toEqual({ dirs: [], uploads: [] });
    expect(state.clock.startedAt).toBe(NOW);
    let removed: Reaped = { dirs: [], uploads: [] };
    let elapsed = 0;
    while (!removed.dirs.length && elapsed < 31 * DAY) {
      elapsed += HOUR;
      process.advance(HOUR);
      removed = await run(elapsed);
    }
    expect(removed).toEqual({ dirs: [id], uploads: [stale] });
    expect(elapsed).toBeGreaterThan(29 * DAY);
  });

  test("a crash loop with a clock a month ahead never moves the reaper clock", async () => {
    const dirs = layout();
    const young = jobDir(dirs.dataDir);
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW });
    const settled = { [young]: NOW - 20 * DAY };
    for (let restart = 0; restart < 500; restart++) {
      const reaped = await reapOnce(at(dirs, settled, NOW + THIRTY, state, fakeProcess()));
      expect(reaped.dirs).toEqual([]);
    }
    expect(state.clock.lastRunAt).toBe(NOW);
    expect(existsSync(join(dirs.dataDir, young))).toBe(true);
  });

  test("two workers up for an hour move the reaper clock one hour, not two", async () => {
    const dirs = layout();
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW });
    const workers = [fakeProcess(), fakeProcess()];
    for (const worker of workers) await reapOnce(at(dirs, {}, NOW + THIRTY, state, worker));
    for (const worker of workers) {
      worker.advance(HOUR);
      await reapOnce(at(dirs, {}, NOW + THIRTY, state, worker));
    }
    expect(state.clock.lastRunAt).toBe(NOW + HOUR);
  });

  test("a stored clock ahead of the system clock removes nothing and restarts the count", async () => {
    const dirs = layout();
    const old = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const process = fakeProcess();
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: Date.UTC(2099, 0, 1) });
    const settled = { [old]: NOW - 400 * DAY };
    expect(await reapOnce(at(dirs, settled, NOW, state, process, lines))).toEqual({
      dirs: [],
      uploads: [],
    });
    expect(lines.join("\n")).toContain("is ahead of the system clock");
    expect(state.clock).toEqual({ startedAt: NOW, lastRunAt: NOW });
    process.advance(HOUR);
    expect((await reapOnce(at(dirs, settled, NOW + HOUR, state, process))).dirs).toEqual([]);
    expect(state.clock.lastRunAt).toBe(NOW + HOUR);
    expect(existsSync(join(dirs.dataDir, old))).toBe(true);
  });

  test("an outage only delays deletion: the reaper clock resumes from where it stopped", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const process = fakeProcess();
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW - 40 * DAY });
    const settled = { [id]: NOW - 35 * DAY };
    expect((await reapOnce(at(dirs, settled, NOW, state, process, lines))).dirs).toEqual([]);
    expect(lines.join("\n")).toContain("only moves as fast as this worker has been up");
    process.advance(6 * DAY);
    expect((await reapOnce(at(dirs, settled, NOW + 6 * DAY, state, process))).dirs).toEqual([]);
    expect(state.clock.lastRunAt).toBe(NOW - 34 * DAY);
    process.advance(30 * DAY);
    expect((await reapOnce(at(dirs, settled, NOW + 36 * DAY, state, process))).dirs).toEqual([id]);
  });
});
