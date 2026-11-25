import { queueMode } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { uploadSettings } from "@conveyor/shared/uploads";
import { workerConcurrency } from "./mode.js";

export interface StartedWorker {
  mode: string;
  stop: () => Promise<void>;
}

export async function startWorker(env: Record<string, string | undefined>): Promise<StartedWorker> {
  const mode = queueMode(env);
  openDb(env.DB_PATH);
  uploadSettings(env);
  const concurrency = mode === "sqlite" ? workerConcurrency(env) : 0;
  console.log(`conveyor worker queue: ${mode}`);
  if (mode === "sqlite") {
    const { startSqliteWorker } = await import("./sqlite.js");
    const worker = startSqliteWorker(env, concurrency);
    console.log("conveyor worker ready");
    return { mode, stop: () => worker.stop() };
  }
  const { startRedisWorker } = await import("./index.js");
  const worker = startRedisWorker(env);
  return { mode, stop: () => worker.stop() };
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
