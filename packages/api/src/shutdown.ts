import { setTimeout as delay } from "node:timers/promises";
import { JOB_STREAM_CLOSE } from "@conveyor/shared";
import type { FastifyInstance } from "fastify";

export const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface SignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
}

export const CLOSE_DEADLINE_MS = 3_000;

export interface Shutdown {
  source: SignalSource;
  exit: (code: number) => void;
  deadlineMs?: number;
}

export function closeOnSignals(app: FastifyInstance, shutdown: Shutdown): void {
  const { source, exit, deadlineMs = CLOSE_DEADLINE_MS } = shutdown;
  let closing = false;
  const stop = (signal: ShutdownSignal) => {
    if (closing) return exit(1);
    closing = true;
    app.log.info(`${signal}: closing`);
    const closed = app.close().then(
      () => 0,
      (err: unknown) => {
        app.log.error({ err }, "close failed");
        return 1;
      },
    );
    const late = delay(deadlineMs, "late" as const, { ref: false });
    Promise.race([closed, late]).then((outcome) => {
      if (outcome !== "late") return exit(outcome);
      app.log.error(`close took over ${deadlineMs} ms`);
      exit(1);
    });
  };
  for (const signal of SHUTDOWN_SIGNALS) source.on(signal, () => stop(signal));
}

export const SOCKET_CLOSE_WAIT_MS = 1_000;

export function closeSocketsRestarting(this: FastifyInstance, done: () => void): void {
  const server = this.websocketServer;
  for (const client of server.clients)
    client.close(JOB_STREAM_CLOSE.restarting, "server restarting");
  const closed = new Promise((resolve) => server.close(resolve));
  Promise.race([closed, delay(SOCKET_CLOSE_WAIT_MS)]).then(() => done());
}
