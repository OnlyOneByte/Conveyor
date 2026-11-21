import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { StageError } from "@conveyor/shared";
import { dbGetPrinter, dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import { type BaseDeps, type QueueWorker, startQueueWorker } from "./loop.js";
import { resolveProfileForSlice } from "./profile.js";
import { buildRegistry } from "./registry.js";

export function sqliteBase(db: Database): BaseDeps {
  return {
    registry: buildRegistry(),
    resolveJobTarget: (r) => dbResolveJobTarget(db, r.printerId, r.profileId),
    resolvePrinter: async (printerId) => {
      const p = dbGetPrinter(db, printerId);
      if (!p) throw new StageError("transport", `unknown printer ${printerId}`);
      return { id: p.id, transportId: p.transportId, address: p.address, secrets: p.secrets };
    },
    resolveProfile: (target, dir) => resolveProfileForSlice(target, dir),
    log: (msg) => console.log(msg),
  };
}

export function startSqliteWorker(env: Record<string, string | undefined>): QueueWorker {
  const db = openDb(env.DB_PATH);
  return startQueueWorker({
    db,
    owner: `${hostname()}:${process.pid}:${randomUUID()}`,
    concurrency: Number(env.WORKER_CONCURRENCY ?? 2),
    dataDir: env.DATA_DIR ?? "/data",
    base: sqliteBase(db),
  });
}
