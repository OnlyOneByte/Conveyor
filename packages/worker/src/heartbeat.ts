import type { Database } from "bun:sqlite";
import { hostname } from "node:os";
import {
  dbForgetWorkerHeartbeat,
  dbWriteWorkerHeartbeat,
  ENGINE_BINARIES,
  type EngineState,
} from "@conveyor/shared/db";

export const HEARTBEAT_EVERY_MS = 15_000;

type Env = Record<string, string | undefined>;
type Which = (bin: string) => string | null;

export function engineStates(env: Env, which: Which = Bun.which): Record<string, EngineState> {
  const stub = env.CONVEYOR_ENGINE_STUB === "1";
  return Object.fromEntries(
    ENGINE_BINARIES.map(({ name, envVar, fallback }) => {
      if (stub) return [name, "stub"];
      return [name, which(env[envVar] ?? fallback) ? "ok" : "missing"];
    }),
  );
}

export const workerId = (env: Env, host: () => string = hostname) =>
  env.CONVEYOR_WORKER_ID?.trim() || host();

export function startHeartbeat(
  db: Database,
  env: Env,
  log: (message: string) => void,
  everyMs = HEARTBEAT_EVERY_MS,
  now: () => number = Date.now,
  which: Which = Bun.which,
): () => void {
  const id = workerId(env);
  const beat = () => {
    try {
      dbWriteWorkerHeartbeat(db, id, { at: now(), engines: engineStates(env, which) });
    } catch (err) {
      log(`heartbeat not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  beat();
  const timer = setInterval(beat, everyMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    try {
      dbForgetWorkerHeartbeat(db, id);
    } catch (err) {
      log(`heartbeat not cleared: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
