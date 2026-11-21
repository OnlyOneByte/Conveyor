export interface ChildHandle {
  kill: () => void;
  exited: Promise<unknown>;
}

export interface StackHandles {
  children: ChildHandle[];
  cleanups: (() => Promise<void>)[];
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

export function createTeardown(handles: StackHandles): () => Promise<void> {
  let running: Promise<void> | undefined;
  const run = async () => {
    for (const child of handles.children) child.kill();
    await Promise.all(handles.children.map((child) => child.exited));
    const results = await Promise.allSettled(handles.cleanups.map((cleanup) => cleanup()));
    const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
    if (failures.length > 0) throw new AggregateError(failures, "stack teardown failed");
  };
  return () => {
    running ??= run();
    return running;
  };
}

export function tearDownOnExit({ events, teardown, exit, report }: TeardownWiring): () => void {
  const listeners = EXIT_TRIGGERS.map((trigger) => {
    const listener = (reason: unknown) => {
      if (trigger === "uncaughtException" || trigger === "unhandledRejection") report(reason);
      teardown()
        .catch(report)
        .finally(() => exit(EXIT_CODES[trigger]));
    };
    events.on(trigger, listener);
    return { trigger, listener };
  });
  return () => {
    for (const { trigger, listener } of listeners) events.off(trigger, listener);
  };
}
