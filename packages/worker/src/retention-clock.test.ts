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
import { type RetentionDeps, reapOnce } from "./retention";

afterEach(cleanupRoots);

describe("upgrading and clock jumps", () => {
  function at(
    dirs: { dataDir: string; uploadDir: string },
    finished: string[],
    now: number,
    state: RetentionDeps["state"],
    lines: string[] = [],
  ) {
    return {
      ...deps(dirs, finished),
      now: () => now,
      finishedBefore: () => finished,
      state,
      log: (line: string) => lines.push(line),
    };
  }

  test("the first run after an upgrade removes nothing; old items go 30 days after it", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const stale = upload(dirs.uploadDir, 400);
    const state = memoryState({});
    const thirty = 30 * DAY;
    const run = (now: number) => reapOnce({ ...at(dirs, [id], now, state), maxAgeMs: thirty });
    expect(await run(NOW)).toEqual({ dirs: [], uploads: [] });
    expect(state.clock.startedAt).toBe(NOW);
    expect(await run(NOW + 29 * DAY)).toEqual({ dirs: [], uploads: [] });
    expect(existsSync(join(dirs.dataDir, id))).toBe(true);
    expect(await run(NOW + 31 * DAY)).toEqual({ dirs: [id], uploads: [stale] });
    expect(state.clock.startedAt).toBe(NOW);
  });

  test("a clock behind the last run skips the run and says so", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW + 60 * 60 * 1000 });
    expect(await reapOnce(at(dirs, [id], NOW, state, lines))).toEqual({ dirs: [], uploads: [] });
    expect(existsSync(join(dirs.dataDir, id))).toBe(true);
    expect(lines.join("\n")).toContain("before the last run");
    expect(state.clock).toEqual({ startedAt: NOW, lastRunAt: NOW });
  });

  test("a clock that jumped forward skips the run and restarts the grace period", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const lines: string[] = [];
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW - 40 * DAY });
    expect(await reapOnce(at(dirs, [id], NOW, state, lines))).toEqual({ dirs: [], uploads: [] });
    expect(lines.join("\n")).toContain("the clock jumped");
    expect(state.clock).toEqual({ startedAt: NOW, lastRunAt: NOW });
    expect(await reapOnce(at(dirs, [id], NOW + 60 * 60 * 1000, state))).toEqual({
      dirs: [],
      uploads: [],
    });
    expect(existsSync(join(dirs.dataDir, id))).toBe(true);
  });

  test("an hourly run inside the window goes ahead", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const state = memoryState({ startedAt: NOW - 365 * DAY, lastRunAt: NOW - 2 * 60 * 60 * 1000 });
    expect((await reapOnce(at(dirs, [id], NOW, state))).dirs).toEqual([id]);
  });
});
