import { messageOf } from "./errors.ts";

export interface ChildHandle {
  kill: (signal?: "SIGKILL") => void;
  exited: Promise<unknown>;
}

export interface StackHandles {
  children: ChildHandle[];
  cleanups: (() => Promise<void>)[];
}

export interface TeardownTiming {
  killAfterMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const EXIT_TRIGGERS = [
  "SIGINT",
  "SIGTERM",
  "uncaughtException",
  "unhandledRejection",
] as const;
export type ExitTrigger = (typeof EXIT_TRIGGERS)[number];

export interface ExitEvents {
  on: (event: ExitTrigger, listener: (reason: unknown) => void) => unknown;
  off: (event: ExitTrigger, listener: (reason: unknown) => void) => unknown;
}

export interface TeardownWiring {
  events: ExitEvents;
  teardown: () => Promise<void>;
  exit: (code: number) => void;
  report: (reason: unknown) => void;
}

const EXIT_CODES: Record<ExitTrigger, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  uncaughtException: 1,
  unhandledRejection: 1,
};

async function stopChild(child: ChildHandle, timing: TeardownTiming): Promise<void> {
  child.kill();
  const hasExited = await Promise.race([
    child.exited.then(() => true),
    timing.sleep(timing.killAfterMs).then(() => false),
  ]);
  if (hasExited) return;
  child.kill("SIGKILL");
  await child.exited;
}

export function createTeardown(handles: StackHandles, timing: TeardownTiming): () => Promise<void> {
  let running: Promise<void> | undefined;
  const run = async () => {
    await Promise.all(handles.children.map((child) => stopChild(child, timing)));
    const results = await Promise.allSettled(handles.cleanups.map((cleanup) => cleanup()));
    const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        `stack teardown failed: ${failures.map(messageOf).join("; ")}`,
      );
  };
  return () => {
    running ??= run();
    return running;
  };
}

export function tearDownOnExit({ events, teardown, exit, report }: TeardownWiring): () => void {
  let isTearingDown = false;
  const listeners = EXIT_TRIGGERS.map((trigger) => {
    const listener = (reason: unknown) => {
      const isSignal = trigger === "SIGINT" || trigger === "SIGTERM";
      if (!isSignal) report(reason);
      if (isSignal && isTearingDown) return exit(EXIT_CODES[trigger]);
      isTearingDown = true;
      teardown().then(
        () => exit(EXIT_CODES[trigger]),
        (err: unknown) => {
          report(err);
          exit(1);
        },
      );
    };
    events.on(trigger, listener);
    return { trigger, listener };
  });
  return () => {
    for (const { trigger, listener } of listeners) events.off(trigger, listener);
  };
}
