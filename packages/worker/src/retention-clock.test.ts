import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
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
  ABANDONED_PART_AGE_MS,
  type ProcessClock,
  processClock,
  type Reaped,
  type RetentionDeps,
  reapOnce,
  startRetention,
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
  test("a system clock that jumps ahead doesn't make an in-flight upload write look abandoned", async () => {
    const dirs = layout();
    const part = (name: string, at: number) => {
      const path = join(dirs.uploadDir, `${name}.stl.part`);
      writeFileSync(path, "sol");
      utimesSync(path, at / 1000, at / 1000);
      return path;
    };
    const [old, inFlight] = [crypto.randomUUID(), crypto.randomUUID()];
    const oldPath = part(old, NOW - ABANDONED_PART_AGE_MS - HOUR);
    const inFlightPath = part(inFlight, NOW - ABANDONED_PART_AGE_MS / 2);
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW });
    const jumped = at(dirs, {}, NOW + 2 * HOUR, state, fakeProcess());
    expect((await reapOnce(jumped)).parts).toEqual([old]);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(inFlightPath)).toBe(true);
  });

  test("the first run after an upgrade removes nothing; old items go 30 days of uptime after it", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const stale = upload(dirs.uploadDir, 400);
    const state = memoryState({});
    const process = fakeProcess();
    const settled = { [id]: NOW - 400 * DAY };
    const run = (elapsed: number) => reapOnce(at(dirs, settled, NOW + elapsed, state, process));
    expect(await run(0)).toEqual({ dirs: [], uploads: [], parts: [] });
    expect(state.clock.startedAt).toBe(NOW);
    let removed: Reaped = { dirs: [], uploads: [], parts: [] };
    let elapsed = 0;
    while (!removed.dirs.length && elapsed < 31 * DAY) {
      elapsed += HOUR;
      process.advance(HOUR);
      removed = await run(elapsed);
    }
    expect(removed).toEqual({ dirs: [id], uploads: [stale], parts: [] });
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
      parts: [],
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

  test("a missing or unreadable last run is a first run: no advance, nothing removed", async () => {
    const dirs = layout();
    const old = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const process = fakeProcess();
    const state = memoryState({ startedAt: NOW - 365 * DAY });
    const settled = { [old]: NOW - 400 * DAY };
    expect(await reapOnce(at(dirs, settled, NOW + THIRTY, state, process, lines))).toEqual({
      dirs: [],
      uploads: [],
      parts: [],
    });
    expect(state.clock).toEqual({ startedAt: NOW + THIRTY, lastRunAt: NOW + THIRTY });
    expect(lines.join("\n")).toContain("the stored reaper clock was missing");
    process.advance(HOUR);
    expect((await reapOnce(at(dirs, settled, NOW + THIRTY + HOUR, state, process))).dirs).toEqual(
      [],
    );
    expect(existsSync(join(dirs.dataDir, old))).toBe(true);
  });

  test("a worker anchors to the stored reaper clock at start-up, not to a wrong system clock", async () => {
    const dirs = layout();
    const process = fakeProcess();
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW });
    const ahead = () => NOW + THIRTY;
    const base = {
      ...dirs,
      finishedBefore: () => [],
      live: async () => ({ ids: new Set<string>(), uploads: new Set<string>() }),
      log: () => {},
      state,
      process,
      now: ahead,
    };
    startRetention({}, base)();
    expect(process.anchor?.clock).toBe(NOW);
    process.advance(HOUR);
    await reapOnce(at(dirs, {}, NOW + THIRTY, state, process));
    expect(state.clock.lastRunAt).toBe(NOW + HOUR);
  });
});
