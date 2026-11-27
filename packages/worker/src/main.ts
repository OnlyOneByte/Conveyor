import { queueMode, retentionDays } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import { settleGroupKills } from "@conveyor/shared/node";
import { uploadSettings } from "@conveyor/shared/uploads";
import { startHeartbeat } from "./heartbeat.js";
import { logger } from "./logger.js";
import { workerConcurrency } from "./mode.js";
import {
  sqliteFinishedBefore,
  sqliteLive,
  sqliteRetentionState,
  startRetention,
} from "./retention.js";

export interface StartedWorker {
  mode: string;
  stop: () => Promise<void>;
}

async function stopAfter(stopHeartbeat: () => void, worker: { stop: () => Promise<void> }) {
  stopHeartbeat();
  await worker.stop();
  await settleGroupKills();
}

export async function startWorker(env: Record<string, string | undefined>): Promise<StartedWorker> {
  const mode = queueMode(env);
  retentionDays(env);
  const db = openDb(env.DB_PATH);
  const dirs = {
    dataDir: env.DATA_DIR ?? "/data",
    uploadDir: uploadSettings(env).dir,
    finishedBefore: (cutoff: number) => sqliteFinishedBefore(db, cutoff),
    state: sqliteRetentionState(db),
    log: (line: string) => logger.info({ component: "retention" }, line),
  };
  const concurrency = mode === "sqlite" ? workerConcurrency(env) : 0;
  logger.info(`conveyor worker queue: ${mode}`);
  const stopHeartbeat = startHeartbeat(db, env, (message) =>
    logger.error({ component: "heartbeat" }, message),
  );
  if (mode === "sqlite") {
    const { startSqliteWorker } = await import("./sqlite.js");
    const worker = startSqliteWorker(env, concurrency);
    const stopRetention = startRetention(env, { ...dirs, live: async () => sqliteLive(db) });
    logger.info("conveyor worker ready");
    return {
      mode,
      stop: () => {
        stopRetention();
        return stopAfter(stopHeartbeat, worker);
      },
    };
  }
  const { startRedisWorker } = await import("./index.js");
  const worker = startRedisWorker(env);
  const stopRetention = startRetention(env, { ...dirs, live: worker.live });
  return {
    mode,
    stop: () => {
      stopRetention();
      return stopAfter(stopHeartbeat, worker);
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
      logger.info(`${signal}: releasing running jobs`);
      void started.stop().then(() => process.exit(0));
    });
  }
}
