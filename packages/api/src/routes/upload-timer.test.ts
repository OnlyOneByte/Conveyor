import { describe, expect, test } from "bun:test";
import { type Timers, UploadTimeout, uploadTimer } from "./upload-timer.js";

function fakeClock() {
  let now = 0;
  let next = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: Timers = (run, ms) => {
    const id = next++;
    pending.set(id, { at: now + ms, run });
    return () => pending.delete(id);
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...pending].sort(([, a], [, b]) => a.at - b.at)) {
      if (timer.at > now || !pending.has(id)) continue;
      pending.delete(id);
      timer.run();
    }
  };
  return { timers, advance, pending: () => pending.size };
}

async function outcome(expired: Promise<never>): Promise<unknown> {
  let state: unknown = "pending";
  expired.catch((error: unknown) => {
    state = error;
  });
  await Bun.sleep(0);
  return state;
}

describe("uploadTimer", () => {
  test("expires when no byte arrives for the idle time, and aborts with an UploadTimeout", async () => {
    const clock = fakeClock();
    const timer = uploadTimer({ idleMs: 100, deadlineMs: 10_000 }, clock.timers);
    const aborted: unknown[] = [];
    timer.onExpire((error) => aborted.push(error));
    clock.advance(99);
    expect(await outcome(timer.expired)).toBe("pending");
    clock.advance(1);
    const error = await outcome(timer.expired);
    expect(error).toBeInstanceOf(UploadTimeout);
    expect(String(error)).toContain("no bytes arrived for 100 ms");
    expect(aborted).toEqual([error]);
    expect(clock.pending()).toBe(0);
  });

  test("each byte restarts the idle time", async () => {
    const clock = fakeClock();
    const timer = uploadTimer({ idleMs: 100, deadlineMs: 10_000 }, clock.timers);
    for (let i = 0; i < 20; i++) {
      clock.advance(90);
      timer.touch();
    }
    expect(await outcome(timer.expired)).toBe("pending");
  });

  test("the overall cap expires however often bytes arrive", async () => {
    const clock = fakeClock();
    const timer = uploadTimer({ idleMs: 100, deadlineMs: 1_000 }, clock.timers);
    for (let i = 0; i < 10; i++) {
      clock.advance(90);
      timer.touch();
    }
    clock.advance(100);
    const error = await outcome(timer.expired);
    expect(error).toBeInstanceOf(UploadTimeout);
    expect(String(error)).toContain("took longer than 1000 ms");
  });

  test("clear cancels both timers, so nothing fires afterwards", async () => {
    const clock = fakeClock();
    const timer = uploadTimer({ idleMs: 100, deadlineMs: 1_000 }, clock.timers);
    let aborted = 0;
    timer.onExpire(() => aborted++);
    timer.clear();
    expect(clock.pending()).toBe(0);
    timer.touch();
    expect(clock.pending()).toBe(0);
    clock.advance(5_000);
    expect(aborted).toBe(0);
    expect(await outcome(timer.expired)).toBe("pending");
  });
});
