import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  type ChildHandle,
  createTeardown,
  EXIT_TRIGGERS,
  type ExitEvents,
  type ExitTrigger,
  type TeardownTiming,
  tearDownOnExit,
} from "./teardown.ts";

interface FakeChild extends ChildHandle {
  signals: string[];
  finishExit: () => void;
}

function fakeChild(calls: string[], name: string, exitsOn: "SIGTERM" | "SIGKILL" | "manual") {
  const { promise, resolve } = Promise.withResolvers<number>();
  const child: FakeChild = {
    signals: [],
    exited: promise.then((code) => {
      calls.push(`exited ${name}`);
      return code;
    }),
    finishExit: () => resolve(0),
    kill: (signal) => {
      const sent = signal ?? "SIGTERM";
      child.signals.push(sent);
      calls.push(`${sent} ${name}`);
      if (sent === exitsOn) resolve(0);
    },
  };
  return child;
}

function neverElapses(): TeardownTiming {
  return { killAfterMs: 5000, sleep: () => new Promise<void>(() => {}) };
}

function manualTimer() {
  const { promise, resolve } = Promise.withResolvers<void>();
  const delays: number[] = [];
  const timing: TeardownTiming = {
    killAfterMs: 5000,
    sleep: (ms) => {
      delays.push(ms);
      return promise;
    },
  };
  return { timing, delays, elapse: resolve };
}

function fakeStack(timing: TeardownTiming = neverElapses()) {
  const calls: string[] = [];
  const children = ["api", "worker", "web"].map((name) => fakeChild(calls, name, "SIGTERM"));
  const cleanups = [
    async () => {
      calls.push("docker rm redis");
    },
    async () => {
      calls.push("rm data dir");
    },
  ];
  return { calls, children, teardown: createTeardown({ children, cleanups }, timing) };
}

function fakeProcess() {
  const emitter = new EventEmitter();
  const events: ExitEvents = {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
  };
  const exits: number[] = [];
  const reports: unknown[] = [];
  const { promise: exited, resolve } = Promise.withResolvers<void>();
  const emit = (trigger: ExitTrigger, reason?: unknown) => emitter.emit(trigger, reason);
  const wiring = {
    events,
    exit: (code: number) => {
      exits.push(code);
      resolve();
    },
    report: (reason: unknown) => reports.push(reason),
  };
  return { emitter, emit, exits, reports, exited, wiring };
}

function failingCleanupTeardown() {
  return createTeardown(
    {
      children: [],
      cleanups: [
        async () => {
          throw new Error("docker rm -f abc failed: no such daemon");
        },
      ],
    },
    neverElapses(),
  );
}

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

  test("sends SIGKILL to a child still running after killAfterMs", async () => {
    const calls: string[] = [];
    const stubborn = fakeChild(calls, "api", "SIGKILL");
    const timer = manualTimer();
    const done = createTeardown({ children: [stubborn], cleanups: [] }, timer.timing)();
    await Bun.sleep(0);
    expect(stubborn.signals).toEqual(["SIGTERM"]);
    expect(timer.delays).toEqual([5000]);
    timer.elapse();
    await done;
    expect(stubborn.signals).toEqual(["SIGTERM", "SIGKILL"]);
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
