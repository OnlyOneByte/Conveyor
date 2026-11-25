import type { Database } from "bun:sqlite";
import { dbWriteWorkerHeartbeat, type EngineState } from "@conveyor/shared/db";

export const HEARTBEAT_EVERY_MS = 15_000;

type Env = Record<string, string | undefined>;
type Which = (bin: string) => string | null;

const ENGINES: [name: string, envVar: string, fallback: string][] = [
  ["openscad", "OPENSCAD_BIN", "openscad"],
  ["orca", "ORCA_BIN", "orca-slicer"],
  ["prusa", "PRUSA_BIN", "prusa-slicer"],
];

export function engineStates(env: Env, which: Which = Bun.which): Record<string, EngineState> {
  const stub = env.CONVEYOR_ENGINE_STUB === "1";
  return Object.fromEntries(
    ENGINES.map(([name, envVar, fallback]) => {
      if (stub) return [name, "stub"];
      return [name, which(env[envVar] ?? fallback) ? "ok" : "missing"];
    }),
  );
}

export function startHeartbeat(
  db: Database,
  env: Env,
  log: (message: string) => void,
  everyMs = HEARTBEAT_EVERY_MS,
  now: () => number = Date.now,
): () => void {
  const engines = engineStates(env);
  const beat = () => {
    try {
      dbWriteWorkerHeartbeat(db, { at: now(), engines });
    } catch (err) {
      log(`heartbeat not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  beat();
  const timer = setInterval(beat, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
