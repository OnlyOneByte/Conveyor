import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { retentionDays } from "@conveyor/shared";
import {
  cleanupRoots,
  deps,
  jobDir,
  layout,
  memoryState,
  NOW,
  none,
  upload,
} from "../test/helpers/retention";
import { ABANDONED_PART_AGE_MS, type LiveJobs, reapOnce, startRetention } from "./retention";

afterEach(cleanupRoots);

describe("job folders", () => {
  test("removes a finished job's folder once it is older than the setting", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    expect(await reapOnce(deps(dirs, [id]))).toEqual({ dirs: [id], uploads: [], parts: [] });
    expect(existsSync(join(dirs.dataDir, id))).toBe(false);
  });

  test("keeps folders of jobs that aren't finished and old, or that are live", async () => {
    const dirs = layout();
    const running = jobDir(dirs.dataDir);
    const liveId = jobDir(dirs.dataDir);
    const live = async () => ({ ids: new Set([liveId]), uploads: new Set<string>() });
    await reapOnce(deps(dirs, [liveId], live));
    expect(existsSync(join(dirs.dataDir, running))).toBe(true);
    expect(existsSync(join(dirs.dataDir, liveId))).toBe(true);
  });

  test("never leaves its own folder: odd ids, the uploads folder and symlinks are left alone", async () => {
    const dirs = layout();
    const linked = randomUUID();
    symlinkSync(dirs.outside, join(dirs.dataDir, linked));
    const odd = ["../outside", "uploads", "a/b", "..", "", `${randomUUID()}/..`, "/etc"];
    const reaped = await reapOnce(deps(dirs, [...odd, linked]));
    expect(reaped.dirs).toEqual([]);
    expect(existsSync(join(dirs.outside, "keep.txt"))).toBe(true);
    expect(existsSync(dirs.uploadDir)).toBe(true);
    expect(existsSync(join(dirs.dataDir, linked))).toBe(true);
  });

  test("a run that dies mid-removal is finished by the next run", async () => {
    const dirs = layout();
    const first = jobDir(dirs.dataDir);
    const second = jobDir(dirs.dataDir);
    const stale = upload(dirs.uploadDir, 30);
    const crashing = deps(dirs, [first, second]);
    crashing.remove = async (path) => {
      rmSync(join(path, "model.gcode"));
      throw new Error("worker stopped");
    };
    await expect(reapOnce(crashing)).rejects.toThrow("worker stopped");
    expect(existsSync(join(dirs.dataDir, first, "nested"))).toBe(true);
    expect(await reapOnce(deps(dirs, [first, second]))).toEqual({
      dirs: [first, second],
      uploads: [stale],
      parts: [],
    });
    expect(existsSync(join(dirs.dataDir, first))).toBe(false);
  });

  test("removes nothing when the live jobs can't be read", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    const stale = upload(dirs.uploadDir, 30);
    const down = async (): Promise<LiveJobs> => {
      throw new Error("queue unreachable");
    };
    await expect(reapOnce(deps(dirs, [id], down))).rejects.toThrow("queue unreachable");
    expect(existsSync(join(dirs.dataDir, id))).toBe(true);
    expect(existsSync(join(dirs.uploadDir, `${stale}.stl`))).toBe(true);
  });
});

describe("uploads", () => {
  test("removes old uploads no live job uses, and keeps the rest", async () => {
    const dirs = layout();
    const stale = upload(dirs.uploadDir, 8);
    const fresh = upload(dirs.uploadDir, 6);
    const used = upload(dirs.uploadDir, 30);
    writeFileSync(join(dirs.uploadDir, "notes.txt"), "x");
    utimesSync(join(dirs.uploadDir, "notes.txt"), 0, 0);
    const live = async () => ({ ids: new Set<string>(), uploads: new Set([used]) });
    expect((await reapOnce(deps(dirs, [], live))).uploads).toEqual([stale]);
    for (const kept of [fresh, used])
      expect(existsSync(join(dirs.uploadDir, `${kept}.stl`))).toBe(true);
    expect(existsSync(join(dirs.uploadDir, "notes.txt"))).toBe(true);
  });

  test("removes an upload write abandoned over an hour ago and keeps one still in flight", async () => {
    const dirs = layout();
    const part = (id: string, ageMs: number) => {
      const path = join(dirs.uploadDir, `${id}.stl.part`);
      writeFileSync(path, "sol");
      utimesSync(path, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
      return path;
    };
    const [old, fresh] = [randomUUID(), randomUUID()];
    part(old, ABANDONED_PART_AGE_MS + 1000);
    const inFlight = part(fresh, ABANDONED_PART_AGE_MS - 60_000);
    const reaped = await reapOnce(deps(dirs, []));
    expect(reaped.parts).toEqual([old]);
    expect(existsSync(join(dirs.uploadDir, `${old}.stl.part`))).toBe(false);
    expect(existsSync(inFlight)).toBe(true);
  });

  test("never follows a symlink or removes a folder named like an upload", async () => {
    const dirs = layout();
    const linked = randomUUID();
    const target = join(dirs.outside, "keep.txt");
    symlinkSync(target, join(dirs.uploadDir, `${linked}.stl`));
    const folder = randomUUID();
    mkdirSync(join(dirs.uploadDir, `${folder}.stl`));
    for (const name of [`${linked}.stl`, `${folder}.stl`])
      utimesSync(join(dirs.uploadDir, name), 0, 0);
    expect((await reapOnce(deps(dirs, []))).uploads).toEqual([]);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(dirs.uploadDir, `${folder}.stl`))).toBe(true);
  });
});

test("CONVEYOR_RETENTION_DAYS defaults to 30, takes whole days, and 0 turns it off", () => {
  expect(retentionDays({})).toBe(30);
  expect(retentionDays({ CONVEYOR_RETENTION_DAYS: " " })).toBe(30);
  expect(retentionDays({ CONVEYOR_RETENTION_DAYS: "30" })).toBe(30);
  expect(retentionDays({ CONVEYOR_RETENTION_DAYS: "0" })).toBe(0);
  for (const bad of ["-1", "1.5", "week"])
    expect(() => retentionDays({ CONVEYOR_RETENTION_DAYS: bad })).toThrow(
      `CONVEYOR_RETENTION_DAYS must be a whole number of days (0 turns it off), got ${bad}`,
    );
});

test("the reaper doesn't run at startup, and not at all with 0 days", async () => {
  const dirs = layout();
  let runs = 0;
  const counting = async () => {
    runs++;
    return none();
  };
  const base = {
    ...dirs,
    finishedBefore: () => [],
    live: counting,
    log: () => {},
    state: memoryState(),
  };
  startRetention({ CONVEYOR_RETENTION_DAYS: "0" }, base)();
  startRetention({}, base)();
  await Promise.resolve();
  expect(runs).toBe(0);
});
