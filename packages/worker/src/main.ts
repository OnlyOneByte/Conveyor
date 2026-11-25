import { queueMode } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { uploadSettings } from "@conveyor/shared/uploads";
import { workerConcurrency } from "./mode.js";
import { retentionDays, sqliteFinishedBefore, sqliteLive, startRetention } from "./retention.js";

export interface StartedWorker {
  mode: string;
  stop: () => Promise<void>;
}

export async function startWorker(env: Record<string, string | undefined>): Promise<StartedWorker> {
  const mode = queueMode(env);
  retentionDays(env);
  const db = openDb(env.DB_PATH);
  const dirs = {
    dataDir: env.DATA_DIR ?? "/data",
    uploadDir: uploadSettings(env).dir,
    finishedBefore: (cutoff: number) => sqliteFinishedBefore(db, cutoff),
    log: (line: string) => console.log(line),
  };
  const concurrency = mode === "sqlite" ? workerConcurrency(env) : 0;
  console.log(`conveyor worker queue: ${mode}`);
  if (mode === "sqlite") {
    const { startSqliteWorker } = await import("./sqlite.js");
    const worker = startSqliteWorker(env, concurrency);
    const stopRetention = startRetention(env, { ...dirs, live: async () => sqliteLive(db) });
    console.log("conveyor worker ready");
    return {
      mode,
      stop: async () => {
        stopRetention();
        await worker.stop();
      },
    };
  }
  const { startRedisWorker } = await import("./index.js");
  const worker = startRedisWorker(env);
  const stopRetention = startRetention(env, { ...dirs, live: worker.live });
  return {
    mode,
    stop: async () => {
      stopRetention();
      await worker.stop();
    },
  };
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
