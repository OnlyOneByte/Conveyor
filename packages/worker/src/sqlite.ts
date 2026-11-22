import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import { type BaseDeps, type QueueWorker, startQueueWorker } from "./loop.js";
import { resolvePrinterTarget } from "./printer-target.js";
import { resolveProfileForSlice } from "./profile.js";
import { buildRegistry } from "./registry.js";

export function sqliteBase(db: Database): BaseDeps {
  return {
    registry: buildRegistry(),
    resolveJobTarget: (r) => dbResolveJobTarget(db, r.printerId, r.profileId),
    resolvePrinter: async (printerId) => resolvePrinterTarget(db, printerId),
    resolveProfile: (target, dir) => resolveProfileForSlice(target, dir),
    log: (msg) => console.log(msg),
  };
}

export function startSqliteWorker(
  env: Record<string, string | undefined>,
  concurrency: number,
): QueueWorker {
  const db = openDb(env.DB_PATH);
  return startQueueWorker({
    db,
    owner: `${hostname()}:${process.pid}:${randomUUID()}`,
    concurrency,
    dataDir: env.DATA_DIR ?? "/data",
    base: sqliteBase(db),
  });
}
