import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FolderFull, folderBudget } from "./uploads-folder.js";

const A = "0b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a01";
const B = "1b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a02";
const C = "2b3f6c1e-6a4d-4c3e-9f1a-2d5e7b8c9a03";
let dir = "";
let clock = 0;
const now = () => clock;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  clock = 0;
});

function folder(): string {
  dir = mkdtempSync(join(tmpdir(), "conveyor-api-budget-"));
  return dir;
}

const part = (id: string) => join(dir, `${id}.stl.part`);
const fits = (take: (bytes: number) => void, bytes: number) => {
  try {
    take(bytes);
    return true;
  } catch (error) {
    if (error instanceof FolderFull) return false;
    throw error;
  }
};

describe("folderBudget", () => {
  test("starts from an async scan of the folder's own files", async () => {
    writeFileSync(join(folder(), `${A}.stl`), Buffer.alloc(600));
    writeFileSync(join(dir, "notes.txt"), Buffer.alloc(5000));
    const budget = await folderBudget(dir, 1000, 60_000, now);
    const hold = await budget.start(part(B));
    expect(fits(hold.take, 401)).toBe(false);
    expect(fits(hold.take, 400)).toBe(true);
    expect(hold.full()).toBe(true);
  });

  test("keeps the stored total in memory between rescans, and refreshes it once one is due", async () => {
    const budget = await folderBudget(folder(), 1000, 60_000, now);
    writeFileSync(join(dir, `${A}.stl`), Buffer.alloc(600));
    clock = 59_999;
    const before = await budget.start(part(B));
    expect(fits(before.take, 1000)).toBe(true);
    before.release();
    clock = 60_000;
    const after = await budget.start(part(C));
    expect(fits(after.take, 401)).toBe(false);
  });

  test("a rescan skips the parts of uploads still running, which it already holds as in flight", async () => {
    const budget = await folderBudget(folder(), 1000, 60_000, now);
    const running = await budget.start(part(A));
    running.take(500);
    writeFileSync(part(A), Buffer.alloc(500));
    clock = 60_000;
    const next = await budget.start(part(B));
    expect(fits(next.take, 500)).toBe(true);
  });

  test("a rescan counts a part no running upload owns", async () => {
    writeFileSync(join(folder(), `${A}.stl.part`), Buffer.alloc(500));
    const budget = await folderBudget(dir, 1000, 60_000, now);
    const hold = await budget.start(part(B));
    expect(fits(hold.take, 501)).toBe(false);
  });

  test("a file kept while a rescan runs is added on top of what the rescan found", async () => {
    const budget = await folderBudget(folder(), 1000, 60_000, now);
    const kept = await budget.start(part(A));
    kept.take(600);
    clock = 60_000;
    const scanning = budget.start(part(B));
    kept.commit(600);
    const next = await scanning;
    expect(fits(next.take, 401)).toBe(false);
    expect(fits(next.take, 400)).toBe(true);
  });

  test("a released reservation gives its bytes back, once", async () => {
    const budget = await folderBudget(folder(), 1000, 60_000, now);
    const first = await budget.start(part(A));
    first.take(800);
    first.release();
    first.release();
    const second = await budget.start(part(B));
    expect(fits(second.take, 1000)).toBe(true);
  });

  test("uploads starting together at the rescan boundary share one scan", async () => {
    let scans = 0;
    const waiting: (() => void)[] = [];
    const gated = async () => {
      scans++;
      if (scans > 1) await new Promise<void>((resolve) => waiting.push(resolve));
      return 0;
    };
    const budget = await folderBudget(folder(), 1000, 60_000, now, gated);
    expect(scans).toBe(1);
    clock = 60_000;
    const starts = Array.from({ length: 5 }, (_, i) => budget.start(part(`${i}${A.slice(1)}`)));
    expect(scans).toBe(2);
    for (const resume of waiting) resume();
    await Promise.all(starts);
    expect(scans).toBe(2);
    clock = 119_999;
    await budget.start(part(B));
    expect(scans).toBe(2);
  });
});
