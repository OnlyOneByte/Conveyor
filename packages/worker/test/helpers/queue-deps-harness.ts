import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dbUpsertPrinter, openDb } from "@conveyor/shared/db";
import {
  claimJob,
  enqueueJob,
  type Lease,
  markSubmitted,
  releaseLease,
  tailEvents,
  takePrinterSlot,
} from "@conveyor/shared/queue";
import { type HarnessOptions, harness, req } from "../../src/pipeline-harness";
import { queueDeps } from "../../src/queue-deps";
import type { PipelineDeps } from "../../src/run";

export let db: Database;
let dir: string;

export function cleanup() {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

export function queued(opts: HarnessOptions = {}, overrides: Partial<PipelineDeps> = {}) {
  dir = mkdtempSync(join(tmpdir(), "conveyor-worker-queue-"));
  db = openDb(join(dir, "conveyor.db"));
  dbUpsertPrinter(db, { id: "p1", transportId: "tr", name: "P1", address: "10.0.0.9" });
  enqueueJob(db, { id: "job-1", request: req });
  const lease = opts.resume ? orphanLease() : claim("w1");
  return harness({
    ...opts,
    deps: (h) => ({
      ...queueDeps({
        db,
        lease,
        controller: h.controller,
        log: () => {},
        progressFlushMs: 50,
        slotRetryMs: 5,
      }).deps,
      ...overrides,
    }),
  });
}

function claim(owner: string): Lease {
  const claimed = claimJob(db, owner);
  if (!claimed) throw new Error("not claimed");
  return claimed.lease;
}

function orphanLease(): Lease {
  const first = claim("w0");
  db.query("UPDATE jobs SET state = 'slicing' WHERE id = 'job-1'").run();
  takePrinterSlot(db, first);
  markSubmitted(db, first, { transportId: "tr", printerId: "p1", ref: "model.gcode" });
  releaseLease(db, first);
  return claim("w1");
}

export const row = () =>
  db.query<Record<string, unknown>, []>("SELECT * FROM jobs WHERE id = 'job-1'").get() ?? {};
export const events = () => tailEvents(db, "job-1", 0).map((e) => e.event);
export const states = () => events().map((e) => e.state);
export const bumpToken = () =>
  db.query("UPDATE jobs SET lease_token = lease_token + 1 WHERE id = 'job-1'").run();
export const hold = () =>
  db.query("SELECT hold_job_id, hold_reason FROM printers WHERE id = 'p1'").get();
