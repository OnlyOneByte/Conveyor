import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LiveJobs,
  type RetentionDeps,
  reapOnce,
  retentionDays,
  startRetention,
} from "./retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-25T12:00:00Z");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function layout() {
  const root = mkdtempSync(join(tmpdir(), "conveyor-retention-"));
  roots.push(root);
  const dataDir = join(root, "data");
  const uploadDir = join(dataDir, "uploads");
  const outside = join(root, "outside");
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "keep.txt"), "not Conveyor's");
  return { root, dataDir, uploadDir, outside };
}

function jobDir(dataDir: string, id = randomUUID()): string {
  mkdirSync(join(dataDir, id, "nested"), { recursive: true });
  writeFileSync(join(dataDir, id, "model.gcode"), "G28\n");
  writeFileSync(join(dataDir, id, "nested", "model.stl"), "solid\n");
  return id;
}

function upload(uploadDir: string, ageDays: number, id = randomUUID()): string {
  const path = join(uploadDir, `${id}.stl`);
  writeFileSync(path, "solid\n");
  const at = (NOW - ageDays * DAY) / 1000;
  utimesSync(path, at, at);
  return id;
}

const none = (): LiveJobs => ({ ids: new Set(), uploads: new Set() });

function deps(
  dirs: { dataDir: string; uploadDir: string },
  finished: string[],
  live: () => Promise<LiveJobs> = async () => none(),
): RetentionDeps {
  return {
    ...dirs,
    maxAgeMs: 7 * DAY,
    now: () => NOW,
    finishedBefore: (cutoff) => (cutoff === NOW - 7 * DAY ? finished : []),
    live,
    log: () => {},
  };
}

describe("job folders", () => {
  test("removes a finished job's folder once it is older than the setting", async () => {
    const dirs = layout();
    const id = jobDir(dirs.dataDir);
    expect(await reapOnce(deps(dirs, [id]))).toEqual({ dirs: [id], uploads: [] });
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

test("CONVEYOR_RETENTION_DAYS defaults to 7, takes whole days, and 0 turns it off", () => {
  expect(retentionDays({})).toBe(7);
  expect(retentionDays({ CONVEYOR_RETENTION_DAYS: " " })).toBe(7);
  expect(retentionDays({ CONVEYOR_RETENTION_DAYS: "30" })).toBe(30);
  expect(retentionDays({ CONVEYOR_RETENTION_DAYS: "0" })).toBe(0);
  for (const bad of ["-1", "1.5", "week"])
    expect(() => retentionDays({ CONVEYOR_RETENTION_DAYS: bad })).toThrow(
      `CONVEYOR_RETENTION_DAYS must be a whole number of days (0 turns it off), got ${bad}`,
    );
});

test("the reaper runs once when the worker starts, and not at all with 0 days", async () => {
  const dirs = layout();
  let runs = 0;
  const counting = async () => {
    runs++;
    return none();
  };
  const base = { ...dirs, finishedBefore: () => [], live: counting, log: () => {} };
  startRetention({ CONVEYOR_RETENTION_DAYS: "0" }, base)();
  expect(runs).toBe(0);
  const stop = startRetention({}, base);
  stop();
  expect(runs).toBe(1);
});
