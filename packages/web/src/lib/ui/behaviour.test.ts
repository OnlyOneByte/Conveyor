import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  closesOn,
  createToasts,
  focusedIndex,
  nextIndex,
  rememberFocus,
  syncTabStop,
  TABBABLE,
  TOAST_MS,
  tabIfScrolls,
  tokenMs,
  wrapTab,
} from "./behaviour";

describe("motion tokens", () => {
  test("reads a duration token as milliseconds, and an unset or reduced one as none", () => {
    const read = ["150ms", " 0.4s", "0ms", ""].map(tokenMs);
    expect(read).toEqual([150, 400, 0, 0]);
  });
});

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
    const moves = [
      nextIndex("ArrowDown", 0, 3),
      nextIndex("ArrowDown", 2, 3),
      nextIndex("ArrowUp", 0, 3),
    ];
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
    const kinds =
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])';
    expect(TABBABLE).toBe(kinds);
  });

  test("Tab from the last control goes to the first, Shift+Tab from the first to the last", () => {
    expect([wrapTab(false, 2, 3), wrapTab(true, 0, 3), wrapTab(false, -1, 3)]).toEqual([0, 2, 0]);
  });

  test("leaves Tab alone between controls and in an empty dialog", () => {
    expect([wrapTab(false, 0, 3), wrapTab(true, 2, 3), wrapTab(false, 0, 0)]).toEqual([
      null,
      null,
      null,
    ]);
  });
});

const fakeClock = () => {
  let at = 0;
  const timers = new Set<{ due: number; run: () => void }>();
  const after = (run: () => void, ms: number) => {
    const timer = { due: at + ms, run };
    timers.add(timer);
    return () => timers.delete(timer);
  };
  const tick = (ms: number) => {
    at += ms;
    for (const timer of [...timers]) if (timer.due <= at && timers.delete(timer)) timer.run();
  };
  return { after, now: () => at, tick, pending: () => timers.size };
};

describe("toasts", () => {
  test("stay for exactly 6 s, then go", () => {
    const clock = fakeClock();
    const toasts = createToasts(clock);
    const run = () => {};
    const id = toasts.show("Canceled Bin 2×1", { label: "Print again", run });
    expect(TOAST_MS).toBe(6000);
    expect(get(toasts)).toEqual([
      { id, text: "Canceled Bin 2×1", action: { label: "Print again", run } },
    ]);
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
    toasts.hold(id, "focus");
    toasts.hold(id, "pointer");
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

  test("pause and resume more than once, keeping the time left each time", () => {
    const clock = fakeClock();
    const toasts = createToasts(clock);
    const id = toasts.show("one");
    clock.tick(1000);
    toasts.hold(id, "focus");
    clock.tick(30_000);
    toasts.release(id, "focus");
    clock.tick(2000);
    toasts.hold(id, "pointer");
    clock.tick(30_000);
    toasts.release(id, "pointer");
    clock.tick(2999);
    expect([get(toasts).length, clock.pending()]).toEqual([1, 1]);
    clock.tick(1);
    expect([get(toasts).length, clock.pending()]).toEqual([0, 0]);
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
  test("say each toast's text once, through the given announcer", () => {
    const said: string[] = [];
    const toasts = createToasts(fakeClock(), (text) => said.push(text));
    const id = toasts.show("Bin 2×1 canceled");
    toasts.hold(id, "focus");
    toasts.release(id, "focus");
    toasts.show("Printing");
    expect(said).toEqual(["Bin 2×1 canceled", "Printing"]);
  });
});

test("focusedIndex finds the focused element among the stops, or -1", () => {
  const [a, b] = [{}, {}];
  expect([focusedIndex([a, b], b), focusedIndex([a, b], null), focusedIndex([a], b)]).toEqual([
    1, -1, -1,
  ]);
});

describe("a scrolling text block's Tab stop", () => {
  const block = (scrollHeight: number, clientHeight: number) => {
    const attrs = new Map<string, string>([["tabindex", "0"]]);
    return {
      attrs,
      node: {
        scrollHeight,
        clientHeight,
        setAttribute: (name: string, value: string) => void attrs.set(name, value),
        removeAttribute: (name: string) => void attrs.delete(name),
      },
    };
  };

  test("text taller than its box is a Tab stop, so it can be scrolled from the keyboard", () => {
    const { node, attrs } = block(900, 192);
    syncTabStop(node);
    expect(attrs.get("tabindex")).toBe("0");
  });

  test("text that fits is not a Tab stop", () => {
    const { node, attrs } = block(40, 40);
    syncTabStop(node);
    expect(attrs.has("tabindex")).toBe(false);
  });
});

describe("the Tab stop's resize watch", () => {
  class Watch {
    static made: Watch[] = [];
    watched: unknown[] = [];
    disconnected = false;
    constructor(readonly changed: () => void) {
      Watch.made.push(this);
    }
    observe(node: unknown) {
      this.watched.push(node);
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  test("re-checks on resize while mounted and stops watching on unmount", () => {
    const real = Reflect.get(globalThis, "ResizeObserver");
    Reflect.set(globalThis, "ResizeObserver", Watch);
    try {
      const attrs = new Map<string, string>();
      const node = {
        scrollHeight: 40,
        clientHeight: 40,
        setAttribute: (name: string, value: string) => void attrs.set(name, value),
        removeAttribute: (name: string) => void attrs.delete(name),
      };
      const mounted = Reflect.apply(tabIfScrolls, undefined, [node]);
      const [watch] = Watch.made;
      expect(watch?.watched).toEqual([node]);
      expect(attrs.has("tabindex")).toBe(false);
      node.scrollHeight = 400;
      watch?.changed();
      expect(attrs.get("tabindex")).toBe("0");
      expect(watch?.disconnected).toBe(false);
      mounted.destroy();
      expect(watch?.disconnected).toBe(true);
    } finally {
      Reflect.set(globalThis, "ResizeObserver", real);
    }
  });
});
