import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { closesOn, createToasts, nextIndex, rememberFocus, TABBABLE, TOAST_MS, wrapTab } from "./behaviour";

describe("focus return", () => {
  test("focuses the element that was active when the surface opened", () => {
    const focused: string[] = [];
    const opener = { focus: () => focused.push("opener") };
    const restore = rememberFocus(() => opener);
    expect(focused).toEqual([]);
    restore();
    expect(focused).toEqual(["opener"]);
  });

  test("does nothing when nothing had focus", () => {
    expect(() => rememberFocus(() => null)()).not.toThrow();
  });
});

describe("menu keys", () => {
  test("arrows wrap around three items, Home and End jump to the ends", () => {
    const moves = [nextIndex("ArrowDown", 0, 3), nextIndex("ArrowDown", 2, 3), nextIndex("ArrowUp", 0, 3)];
    moves.push(nextIndex("ArrowUp", 2, 3), nextIndex("Home", 2, 3), nextIndex("End", 0, 3));
    expect(moves).toEqual([1, 0, 2, 1, 0, 2]);
    expect([nextIndex("a", 0, 3), nextIndex("ArrowDown", 0, 0)]).toEqual([null, null]);
  });

  test("closes on Escape and on Tab", () => {
    expect([closesOn("Escape"), closesOn("Tab"), closesOn("Enter")]).toEqual([true, true, false]);
  });
});

describe("dialog focus trap", () => {
  test("wraps over every tabbable kind, minus disabled controls and tabindex -1", () => {
    const kinds = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
    expect(TABBABLE).toBe(kinds);
  });

  test("Tab from the last control goes to the first, Shift+Tab from the first to the last", () => {
    expect([wrapTab(false, 2, 3), wrapTab(true, 0, 3), wrapTab(false, -1, 3)]).toEqual([0, 2, 0]);
  });

  test("leaves Tab alone between controls and in an empty dialog", () => {
    expect([wrapTab(false, 0, 3), wrapTab(true, 2, 3), wrapTab(false, 0, 0)]).toEqual([null, null, null]);
  });
});

const fakeClock = () => {
  let at = 0;
  const timers = new Set<{ due: number; run: () => void }>();
  const after = (run: () => void, ms: number) => { const timer = { due: at + ms, run }; timers.add(timer); return () => timers.delete(timer); };
  const tick = (ms: number) => { at += ms; for (const timer of [...timers]) if (timer.due <= at && timers.delete(timer)) timer.run(); };
  return { after, now: () => at, tick, pending: () => timers.size };
};

describe("toasts", () => {
  test("stay for exactly 6 s, then go", () => {
    const clock = fakeClock();
    const toasts = createToasts(clock);
    const run = () => {};
    const id = toasts.show("Canceled Bin 2×1", { label: "Print again", run });
    expect(TOAST_MS).toBe(6000);
    expect(get(toasts)).toEqual([{ id, text: "Canceled Bin 2×1", action: { label: "Print again", run } }]);
    clock.tick(5999);
    expect(get(toasts)).toHaveLength(1);
    clock.tick(1);
    expect(get(toasts)).toEqual([]);
  });

  test("pause while focused or pointed at, and resume with the time that was left", () => {
    const clock = fakeClock();
    const toasts = createToasts(clock);
    const id = toasts.show("one");
    clock.tick(4000);
    toasts.hold(id, "focus"); toasts.hold(id, "pointer");
    clock.tick(60_000);
    toasts.release(id, "pointer");
    clock.tick(60_000);
    expect(get(toasts)).toHaveLength(1);
    toasts.release(id, "focus");
    clock.tick(1999);
    expect(get(toasts)).toHaveLength(1);
    clock.tick(1);
    expect(get(toasts)).toEqual([]);
  });

  test("dismissing one leaves the others and stops its timer", () => {
    const clock = fakeClock();
    const toasts = createToasts(clock);
    const first = toasts.show("one");
    toasts.show("two");
    toasts.dismiss(first);
    toasts.release(first, "focus");
    expect([get(toasts).map((t) => t.text), clock.pending()]).toEqual([["two"], 1]);
  });
});
