import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { closesOn, createToasts, nextIndex, rememberFocus, TOAST_MS, wrapTab } from "./behaviour";

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

  test("closes on Escape only", () => {
    expect([closesOn("Escape"), closesOn("Enter"), closesOn("Tab")]).toEqual([true, false, false]);
  });
});

describe("dialog focus trap", () => {
  test("Tab from the last control goes to the first, Shift+Tab from the first to the last", () => {
    expect([wrapTab(false, 2, 3), wrapTab(true, 0, 3), wrapTab(false, -1, 3)]).toEqual([0, 2, 0]);
  });

  test("leaves Tab alone between controls and in an empty dialog", () => {
    expect([wrapTab(false, 0, 3), wrapTab(true, 2, 3), wrapTab(false, 0, 0)]).toEqual([null, null, null]);
  });
});

describe("toasts", () => {
  test("show a toast, then dismiss it after the toast time", () => {
    const pending: [() => void, number][] = [];
    const toasts = createToasts((run, ms) => pending.push([run, ms]));
    const run = () => {};
    const id = toasts.show("Canceled Bin 2×1", { label: "Print again", run });
    expect(get(toasts)).toEqual([{ id, text: "Canceled Bin 2×1", action: { label: "Print again", run } }]);
    expect(pending.map(([, ms]) => ms)).toEqual([TOAST_MS]);
    pending[0]?.[0]();
    expect(get(toasts)).toEqual([]);
  });

  test("dismissing one leaves the others, and a late timer is harmless", () => {
    const pending: (() => void)[] = [];
    const toasts = createToasts((run) => pending.push(run));
    const first = toasts.show("one");
    toasts.show("two");
    toasts.dismiss(first);
    pending[0]?.();
    expect(get(toasts).map((t) => t.text)).toEqual(["two"]);
  });
});
