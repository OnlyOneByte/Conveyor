import { expect, test } from "bun:test";
import { PrintNotStartedError, StageError } from "@conveyor/shared";
import { memoryLocks } from "../test/helpers/memory-locks";
import { printerLock, printerLockKey } from "./printer-lock";
import { JobCanceledError } from "./run";

const quiet = { held: () => null, log: () => {}, pollMs: 5 };

test("a second job waits for the first to release the printer, then takes it", async () => {
  const store = memoryLocks();
  const lock = printerLock(store, quiet);
  const first = await lock.acquire("p1", new AbortController().signal);
  let second = false;
  const waiting = lock.acquire("p1", new AbortController().signal).then((held) => {
    second = true;
    return held;
  });
  await Bun.sleep(30);
  expect(second).toBe(false);
  await first.release();
  await (await waiting).release();
  expect(second).toBe(true);
  expect(store.held.size).toBe(0);
});

test("a cancel while waiting for the printer ends the wait as a cancel", async () => {
  const lock = printerLock(memoryLocks(), quiet);
  const first = await lock.acquire("p1", new AbortController().signal);
  const cancel = new AbortController();
  const waiting = lock.acquire("p1", cancel.signal);
  cancel.abort();
  await expect(waiting).rejects.toBeInstanceOf(JobCanceledError);
  await first.release();
});

test("a printer on hold is refused at once, without waiting for the lock", async () => {
  const lock = printerLock(memoryLocks(), {
    ...quiet,
    held: () => "the print start got no answer",
  });
  const taking = lock.acquire("p1", new AbortController().signal);
  await expect(taking).rejects.toBeInstanceOf(StageError);
  await expect(taking).rejects.toThrow("printer is on hold: the print start got no answer");
});

test("a lock whose worker died expires after its TTL, so the printer is never stuck", async () => {
  let clock = 0;
  const store = memoryLocks(() => clock);
  const lock = printerLock(store, { ...quiet, ttlMs: 60_000 });
  await store.claim(printerLockKey("p1"), "dead-worker", 60_000);
  const waiting = lock.acquire("p1", new AbortController().signal);
  await Bun.sleep(20);
  clock = 60_001;
  const held = await waiting;
  expect(store.held.get(printerLockKey("p1"))).not.toBe("dead-worker");
  await held.release();
});

test("a held lock is renewed before its TTL runs out, so a long print keeps it", async () => {
  let clock = 0;
  const store = memoryLocks(() => clock);
  const lock = printerLock(store, { ...quiet, ttlMs: 30 });
  const held = await lock.acquire("p1", new AbortController().signal);
  for (let step = 0; step < 6; step++) {
    clock += 15;
    await Bun.sleep(15);
  }
  expect(await store.claim(printerLockKey("p1"), "intruder", 30)).toBe(false);
  await held.release();
});

test("release only drops the job's own lock, never one another job has since taken", async () => {
  let clock = 0;
  const store = memoryLocks(() => clock);
  const lock = printerLock(store, { ...quiet, ttlMs: 1_000_000 });
  const held = await lock.acquire("p1", new AbortController().signal);
  clock = 2_000_000;
  await store.claim(printerLockKey("p1"), "next-job", 1_000_000);
  await held.release();
  expect(store.held.get(printerLockKey("p1"))).toBe("next-job");
});

test("the start is confirmed while the lock is held, and refused once a renewal fails", async () => {
  const store = memoryLocks();
  const lock = printerLock(store, { ...quiet, ttlMs: 30 });
  const held = await lock.acquire("p1", new AbortController().signal);
  await held.confirm();
  store.failRenewalsOf = store.held.get(printerLockKey("p1"));
  await Bun.sleep(25);
  store.failRenewalsOf = undefined;
  await expect(held.confirm()).rejects.toBeInstanceOf(PrintNotStartedError);
  await held.release();
});

test("a lock that went a whole TTL without a renewal is lost, even if the key still reads as ours", async () => {
  let clock = 0;
  const store = memoryLocks(() => 0);
  const lock = printerLock(store, { ...quiet, ttlMs: 60_000, now: () => clock });
  const held = await lock.acquire("p1", new AbortController().signal);
  clock = 60_000;
  await expect(held.confirm()).rejects.toThrow(
    "the printer lock was lost before the print started",
  );
  await held.release();
});

test("the start is refused when another job holds the key, even before any renewal ran", async () => {
  const store = memoryLocks();
  const lock = printerLock(store, { ...quiet, ttlMs: 60_000 });
  const held = await lock.acquire("p1", new AbortController().signal);
  store.held.set(printerLockKey("p1"), "another-job");
  await expect(held.confirm()).rejects.toBeInstanceOf(PrintNotStartedError);
  await held.release();
  expect(store.held.get(printerLockKey("p1"))).toBe("another-job");
});
