import { describe, expect, test } from "bun:test";
import { createTeardown, EXIT_TRIGGERS, tearDownOnExit } from "./teardown.ts";
import {
  failingCleanupTeardown,
  fakeChild,
  fakeProcess,
  fakeStack,
  manualTimer,
  neverElapses,
} from "./teardown-fakes.ts";

describe("createTeardown", () => {
  test("kills every child, waits for it, then removes the container and the data dir", async () => {
    const stack = fakeStack();
    await stack.teardown();
    expect(stack.calls.slice(0, 3)).toEqual(["SIGTERM api", "SIGTERM worker", "SIGTERM web"]);
    expect(stack.calls.slice(-2)).toEqual(["docker rm redis", "rm data dir"]);
  });

  test("runs no cleanup until every child has exited", async () => {
    const calls: string[] = [];
    const slow = fakeChild(calls, "web", "manual");
    const cleanups = [
      async () => {
        calls.push("docker rm redis");
      },
    ];
    const done = createTeardown({ children: [slow], cleanups }, neverElapses())();
    await Bun.sleep(0);
    expect(calls).toEqual(["SIGTERM web"]);
    slow.finishExit();
    await done;
    expect(calls).toEqual(["SIGTERM web", "exited web", "docker rm redis"]);
  });

  test("sends SIGKILL after killAfterMs and waits for the child to exit before cleanup", async () => {
    const calls: string[] = [];
    const stubborn = fakeChild(calls, "api", "manual");
    const timer = manualTimer();
    const cleanups = [
      async () => {
        calls.push("docker rm redis");
      },
    ];
    const done = createTeardown({ children: [stubborn], cleanups }, timer.timing)();
    await Bun.sleep(0);
    expect(stubborn.signals).toEqual(["SIGTERM"]);
    expect(timer.delays).toEqual([5000]);
    timer.elapse();
    await Bun.sleep(0);
    expect(stubborn.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(calls).not.toContain("docker rm redis");
    stubborn.finishExit();
    await done;
    expect(calls).toEqual(["SIGTERM api", "SIGKILL api", "exited api", "docker rm redis"]);
  });

  test("does not SIGKILL a child that exited on SIGTERM", async () => {
    const timer = manualTimer();
    const stack = fakeStack(timer.timing);
    await stack.teardown();
    timer.elapse();
    await Bun.sleep(0);
    expect(stack.children.map((c) => c.signals)).toEqual([["SIGTERM"], ["SIGTERM"], ["SIGTERM"]]);
  });

  test("runs once however many times it is called", async () => {
    const stack = fakeStack();
    await Promise.all([stack.teardown(), stack.teardown(), stack.teardown()]);
    await stack.teardown();
    expect(stack.children.map((c) => c.signals.length)).toEqual([1, 1, 1]);
    expect(stack.calls.filter((c) => c === "docker rm redis")).toHaveLength(1);
  });

  test("still runs the other cleanups when one fails, then rejects naming the failure", async () => {
    const calls: string[] = [];
    const teardown = createTeardown(
      {
        children: [],
        cleanups: [
          async () => {
            throw new Error("docker gone");
          },
          async () => {
            calls.push("rm data dir");
          },
        ],
      },
      neverElapses(),
    );
    await expect(teardown()).rejects.toThrow("stack teardown failed: docker gone");
    expect(calls).toEqual(["rm data dir"]);
  });
});

describe("tearDownOnExit", () => {
  test.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("%s tears the stack down once, then exits %d", async (signal, code) => {
    const stack = fakeStack();
    const proc = fakeProcess();
    tearDownOnExit({ ...proc.wiring, teardown: stack.teardown });
    proc.emit(signal);
    await proc.exited;
    expect(stack.children.map((c) => c.signals.length)).toEqual([1, 1, 1]);
    expect(stack.calls.filter((c) => c === "docker rm redis")).toHaveLength(1);
    expect(stack.calls).toContain("rm data dir");
    expect(proc.exits).toEqual([code]);
  });

  test("a second signal during teardown exits at once without a second teardown", async () => {
    const calls: string[] = [];
    const stuck = fakeChild(calls, "web", "manual");
    let teardowns = 0;
    const teardown = createTeardown({ children: [stuck], cleanups: [] }, neverElapses());
    const proc = fakeProcess();
    tearDownOnExit({
      ...proc.wiring,
      teardown: () => {
        teardowns++;
        return teardown();
      },
    });
    proc.emit("SIGINT");
    expect(proc.exits).toEqual([]);
    proc.emit("SIGTERM");
    expect(proc.exits).toEqual([143]);
    expect(teardowns).toBe(1);
    expect(String(proc.reports[0])).toContain(
      "forced exit before teardown finished; may be left behind: Redis container cid-1",
    );
  });

  test("a teardown that fails after a signal is reported and exits 1", async () => {
    const proc = fakeProcess();
    tearDownOnExit({ ...proc.wiring, teardown: failingCleanupTeardown() });
    proc.emit("SIGINT");
    await proc.exited;
    expect(proc.reports).toHaveLength(1);
    expect(proc.reports[0]).toBeInstanceOf(AggregateError);
    expect(String(proc.reports[0])).toContain("docker rm -f abc failed: no such daemon");
    expect(proc.exits).toEqual([1]);
  });

  test.each(["uncaughtException", "unhandledRejection"] as const)(
    "%s is reported, the stack torn down, and the process exits 1",
    async (trigger) => {
      const stack = fakeStack();
      const proc = fakeProcess();
      tearDownOnExit({ ...proc.wiring, teardown: stack.teardown });
      const boom = new Error("boom");
      proc.emit(trigger, boom);
      await proc.exited;
      expect(proc.reports).toEqual([boom]);
      expect(stack.calls).toContain("docker rm redis");
      expect(proc.exits).toEqual([1]);
    },
  );

  test("detaching removes every listener it added", () => {
    const proc = fakeProcess();
    const detach = tearDownOnExit({ ...proc.wiring, teardown: async () => {} });
    expect(EXIT_TRIGGERS.map((t) => proc.emitter.listenerCount(t))).toEqual([1, 1, 1, 1]);
    detach();
    expect(EXIT_TRIGGERS.map((t) => proc.emitter.listenerCount(t))).toEqual([0, 0, 0, 0]);
  });
});
