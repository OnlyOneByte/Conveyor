import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveJobs, RetentionClock, RetentionDeps } from "../../src/retention";

export const DAY = 24 * 60 * 60 * 1000;
export const NOW = Date.parse("2026-11-25T12:00:00Z");
const roots: string[] = [];

export function cleanupRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

export function layout() {
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

export function jobDir(dataDir: string, id = randomUUID()): string {
  mkdirSync(join(dataDir, id, "nested"), { recursive: true });
  writeFileSync(join(dataDir, id, "model.gcode"), "G28\n");
  writeFileSync(join(dataDir, id, "nested", "model.stl"), "solid\n");
  return id;
}

export function upload(uploadDir: string, ageDays: number, id = randomUUID()): string {
  const path = join(uploadDir, `${id}.stl`);
  writeFileSync(path, "solid\n");
  const at = (NOW - ageDays * DAY) / 1000;
  utimesSync(path, at, at);
  return id;
}

export const none = (): LiveJobs => ({ ids: new Set(), uploads: new Set() });

export function memoryState(
  clock: RetentionClock = { startedAt: NOW - 365 * DAY, lastRunAt: NOW },
) {
  const state = { ...clock };
  return {
    clock: state,
    read: () => ({ ...state }),
    write: (next: Required<RetentionClock>) => Object.assign(state, next),
  };
}

export function deps(
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
    state: memoryState(),
  };
}
