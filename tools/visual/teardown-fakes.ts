import { EventEmitter } from "node:events";
import {
  type ChildHandle,
  createTeardown,
  type ExitEvents,
  type ExitTrigger,
  type TeardownTiming,
} from "./teardown.ts";

export interface FakeChild extends ChildHandle {
  signals: string[];
  finishExit: () => void;
}

export function fakeChild(
  calls: string[],
  name: string,
  exitsOn: "SIGTERM" | "SIGKILL" | "manual",
) {
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

export function neverElapses(): TeardownTiming {
  return { killAfterMs: 5000, sleep: () => new Promise<void>(() => {}) };
}

export function manualTimer() {
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

export function fakeStack(timing: TeardownTiming = neverElapses()) {
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

export function fakeProcess() {
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
    leftovers: () => ["Redis container cid-1 (remove it with: docker rm -f cid-1)"],
  };
  return { emitter, emit, exits, reports, exited, wiring };
}

export function failingCleanupTeardown() {
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
