import { queueMode } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { uploadSettings } from "@conveyor/shared/uploads";
import { startHeartbeat } from "./heartbeat.js";
import { workerConcurrency } from "./mode.js";

export interface StartedWorker {
  mode: string;
  stop: () => Promise<void>;
}

function stopAfter(stopHeartbeat: () => void, worker: { stop: () => Promise<void> }) {
  stopHeartbeat();
  return worker.stop();
}

export async function startWorker(env: Record<string, string | undefined>): Promise<StartedWorker> {
  const mode = queueMode(env);
  const db = openDb(env.DB_PATH);
  uploadSettings(env);
  const concurrency = mode === "sqlite" ? workerConcurrency(env) : 0;
  console.log(`conveyor worker queue: ${mode}`);
  const stopHeartbeat = startHeartbeat(db, env, (message) => console.error(message));
  if (mode === "sqlite") {
    const { startSqliteWorker } = await import("./sqlite.js");
    const worker = startSqliteWorker(env, concurrency);
    console.log("conveyor worker ready");
    return { mode, stop: () => stopAfter(stopHeartbeat, worker) };
  }
  const { startRedisWorker } = await import("./index.js");
  const worker = startRedisWorker(env);
  return { mode, stop: () => stopAfter(stopHeartbeat, worker) };
}

if (import.meta.main) {
  const started = await startWorker(process.env).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      console.log(`${signal}: releasing running jobs`);
      void started.stop().then(() => process.exit(0));
    });
  }
}
