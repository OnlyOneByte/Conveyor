import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { StageError } from "@conveyor/shared";
import { dbGetPrinter, dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import { startQueueWorker } from "./loop.js";
import { resolveProfileForSlice } from "./profile.js";
import { buildRegistry } from "./registry.js";

const db = openDb();
const worker = startQueueWorker({
  db,
  owner: `${hostname()}:${process.pid}:${randomUUID()}`,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  dataDir: process.env.DATA_DIR ?? "/data",
  base: {
    registry: buildRegistry(),
    resolveJobTarget: (r) => dbResolveJobTarget(db, r.printerId, r.profileId),
    resolvePrinter: async (printerId) => {
      const p = dbGetPrinter(db, printerId);
      if (!p) throw new StageError("transport", `unknown printer ${printerId}`);
      return { id: p.id, transportId: p.transportId, address: p.address, secrets: p.secrets };
    },
    resolveProfile: (target, dir) => resolveProfileForSlice(target, dir),
    log: (msg) => console.log(msg),
  },
});
console.log("conveyor worker ready");

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`${signal}: releasing running jobs`);
    void worker.stop().then(() => process.exit(0));
  });
}
