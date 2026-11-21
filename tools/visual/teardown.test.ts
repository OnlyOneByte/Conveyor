import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  type ChildHandle,
  createTeardown,
  EXIT_TRIGGERS,
  type ExitEvents,
  type ExitTrigger,
  tearDownOnExit,
} from "./teardown.ts";

function fakeChild(calls: string[], name: string): ChildHandle & { kills: number } {
  const { promise, resolve } = Promise.withResolvers<number>();
  const child = {
    kills: 0,
    exited: promise,
    kill: () => {
      child.kills++;
      calls.push(`kill ${name}`);
      resolve(0);
    },
  };
  return child;
}

function fakeStack() {
  const calls: string[] = [];
  const children = ["api", "worker", "web"].map((name) => fakeChild(calls, name));
  const cleanups = [
    async () => {
      calls.push("docker rm redis");
    },
    async () => {
      calls.push("rm data dir");
    },
  ];
  return { calls, children, teardown: createTeardown({ children, cleanups }) };
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

describe("createTeardown", () => {
  test("kills every child, waits for it, then removes the container and the data dir", async () => {
    const stack = fakeStack();
    await stack.teardown();
    expect(stack.calls).toEqual([
      "kill api",
      "kill worker",
      "kill web",
      "docker rm redis",
      "rm data dir",
    ]);
  });

  test("runs once however many times it is called", async () => {
    const stack = fakeStack();
    await Promise.all([stack.teardown(), stack.teardown(), stack.teardown()]);
    await stack.teardown();
    expect(stack.children.map((c) => c.kills)).toEqual([1, 1, 1]);
    expect(stack.calls.filter((c) => c === "docker rm redis")).toHaveLength(1);
  });

  test("still runs the other cleanups when one fails, then rejects", async () => {
    const calls: string[] = [];
    const teardown = createTeardown({
      children: [],
      cleanups: [
        async () => {
          throw new Error("docker gone");
        },
        async () => {
          calls.push("rm data dir");
        },
      ],
    });
    await expect(teardown()).rejects.toThrow("stack teardown failed");
    expect(calls).toEqual(["rm data dir"]);
  });
});

describe("tearDownOnExit", () => {
  test("SIGINT tears the stack down once even when the signal repeats, then exits 130", async () => {
    const stack = fakeStack();
    const proc = fakeProcess();
    tearDownOnExit({ ...proc.wiring, teardown: stack.teardown });
    proc.emit("SIGINT");
    proc.emit("SIGINT");
    proc.emit("SIGTERM");
    await proc.exited;
    await stack.teardown();
    expect(stack.children.map((c) => c.kills)).toEqual([1, 1, 1]);
    expect(stack.calls.filter((c) => c === "docker rm redis")).toHaveLength(1);
    expect(proc.exits[0]).toBe(130);
  });

  test("SIGTERM removes the container before exiting 143", async () => {
    const stack = fakeStack();
    const proc = fakeProcess();
    tearDownOnExit({ ...proc.wiring, teardown: stack.teardown });
    proc.emit("SIGTERM");
    await proc.exited;
    expect(stack.calls).toContain("docker rm redis");
    expect(proc.exits).toEqual([143]);
  });

  test("an uncaught error is reported, the stack torn down, and the process exits 1", async () => {
    const stack = fakeStack();
    const proc = fakeProcess();
    tearDownOnExit({ ...proc.wiring, teardown: stack.teardown });
    const boom = new Error("boom");
    proc.emit("uncaughtException", boom);
    await proc.exited;
    expect(proc.reports).toEqual([boom]);
    expect(stack.calls).toContain("rm data dir");
    expect(proc.exits).toEqual([1]);
  });

  test("an unhandled rejection tears the stack down and exits 1", async () => {
    const stack = fakeStack();
    const proc = fakeProcess();
    tearDownOnExit({ ...proc.wiring, teardown: stack.teardown });
    proc.emit("unhandledRejection", "nope");
    await proc.exited;
    expect(stack.calls).toContain("docker rm redis");
    expect(proc.exits).toEqual([1]);
  });

  test("detaching removes every listener it added", () => {
    const proc = fakeProcess();
    const detach = tearDownOnExit({ ...proc.wiring, teardown: async () => {} });
    expect(EXIT_TRIGGERS.map((t) => proc.emitter.listenerCount(t))).toEqual([1, 1, 1, 1]);
    detach();
    expect(EXIT_TRIGGERS.map((t) => proc.emitter.listenerCount(t))).toEqual([0, 0, 0, 0]);
  });
});
