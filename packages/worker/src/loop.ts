import { type Database, SQLiteError } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  type ClaimedJob,
  claimJob,
  DEFAULT_TIMING,
  EVENT_RETENTION_MS,
  isCancelRequested,
  type Lease,
  leaseHeld,
  pruneEvents,
  type QueueTiming,
  reapExpired,
  releaseLease,
  renewLease,
} from "@conveyor/shared/queue";
import { jobFolder, refusedJobId } from "./job-folder.js";
import { resumeJob, runJob } from "./pipeline.js";
import { queueDeps } from "./queue-deps.js";
import { LeaseLostError, type PipelineDeps, type QueueHooks } from "./run.js";

export type BaseDeps = Omit<PipelineDeps, "publish" | "record" | "cancelRequested" | "queue"> & {
  logFor?(jobId: string): (msg: string) => void;
};

export interface QueueWorkerOptions {
  db: Database;
  owner: string;
  concurrency: number;
  dataDir: string;
  base: BaseDeps;
  timing?: QueueTiming;
  claimIdleMs?: number;
  tickMs?: number;
  renewEvery?: number;
  busyRetryMs?: number;
  busyMarginMs?: number;
  reapMs?: number;
  pruneMs?: number;
  retentionMs?: number;
  progressFlushMs?: number;
}

export interface QueueWorker {
  stop(): Promise<void>;
}

interface Running {
  lease: Lease;
  controller: AbortController;
  engine: boolean;
  phase: "preparing" | "submitting" | "on-printer";
  released: boolean;
  renewing: boolean;
  done: Promise<void>;
}

const isBusy = (err: unknown) => err instanceof SQLiteError && err.code === "SQLITE_BUSY";

export function startQueueWorker(o: QueueWorkerOptions): QueueWorker {
  const timing = o.timing ?? DEFAULT_TIMING;
  const tickMs = o.tickMs ?? 1000;
  const renewEvery = o.renewEvery ?? 10;
  const busyRetryMs = o.busyRetryMs ?? 1000;
  const busyMarginMs = o.busyMarginMs ?? 5000;
  const running = new Map<string, Running>();
  let stopping = false;

  const lose = (job: Running) => {
    if (!job.controller.signal.aborted) job.controller.abort(new LeaseLostError());
  };

  async function renew(job: Running): Promise<void> {
    if (job.renewing) return;
    job.renewing = true;
    try {
      while (!job.controller.signal.aborted) {
        try {
          const next = renewLease(o.db, job.lease, timing);
          if (next) job.lease = { ...job.lease, until: next.until };
          else lose(job);
          return;
        } catch (err) {
          if (!isBusy(err) || timing.now() + busyRetryMs > job.lease.until - busyMarginMs) {
            o.base.log(`job ${job.lease.jobId}: lease renewal failed: ${String(err)}`);
            lose(job);
            return;
          }
          await delay(busyRetryMs);
        }
      }
    } finally {
      job.renewing = false;
    }
  }

  function track(job: Running, hooks: QueueHooks): QueueHooks {
    return {
      ...hooks,
      takeSlot: async (signal) => {
        if (job.engine) {
          job.engine = false;
          pump();
        }
        const outcome = await hooks.takeSlot(signal);
        if (outcome === "taken") job.phase = "submitting";
        return outcome;
      },
      markSubmitted: async (handle) => {
        await hooks.markSubmitted(handle);
        job.phase = "on-printer";
        if (job.released) lose(job);
      },
    };
  }

  async function run(claimed: ClaimedJob, job: Running): Promise<void> {
    const { jobId } = claimed.lease;
    const q = queueDeps({
      db: o.db,
      lease: claimed.lease,
      controller: job.controller,
      log: o.base.log,
      timing,
      progressFlushMs: o.progressFlushMs,
      slotRetryMs: o.claimIdleMs,
    });
    let tick = 0;
    const timer = setInterval(() => {
      tick++;
      try {
        if (isCancelRequested(o.db, jobId)) job.controller.abort();
        if (!job.released && !leaseHeld(o.db, job.lease, timing)) lose(job);
      } catch (err) {
        o.base.log(`job ${jobId}: cancel check failed: ${String(err)}`);
      }
      if (tick % renewEvery === 0) void renew(job);
    }, tickMs);
    const workDir = jobFolder(o.dataDir, jobId);
    try {
      if (!workDir) {
        const reason = refusedJobId(jobId);
        await q.deps.publish(jobId, "failed", {
          stage: "generator",
          error: { stage: "generator", reason },
        });
        o.base.log(`job ${jobId}: ${reason}`);
        return;
      }
      if (!claimed.resumed) await rm(workDir, { recursive: true, force: true });
      await mkdir(workDir, { recursive: true });
      const log = o.base.logFor?.(jobId) ?? o.base.log;
      const deps: PipelineDeps = { ...o.base, ...q.deps, log };
      if (deps.queue) deps.queue = track(job, deps.queue);
      const opts = { jobId, req: claimed.request, workDir, controller: job.controller };
      const state = await (claimed.resumed ? resumeJob : runJob)(opts, deps);
      o.base.log(`job ${jobId}: ${state}`);
    } catch (err) {
      o.base.log(`job ${jobId}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearInterval(timer);
      q.dispose();
      if (job.released) {
        o.base.log(`job ${jobId}: released, ${releaseLease(o.db, job.lease, timing)}`);
      }
      running.delete(jobId);
      pump();
    }
  }

  function start(claimed: ClaimedJob): void {
    const job: Running = {
      lease: claimed.lease,
      controller: new AbortController(),
      engine: !claimed.resumed,
      phase: claimed.resumed ? "on-printer" : "preparing",
      released: false,
      renewing: false,
      done: Promise.resolve(),
    };
    running.set(claimed.lease.jobId, job);
    job.done = run(claimed, job);
  }

  function pump(): void {
    while (!stopping) {
      const engines = [...running.values()].filter((job) => job.engine).length;
      if (engines >= o.concurrency) return;
      let claimed: ClaimedJob | null;
      try {
        claimed = claimJob(o.db, o.owner, timing);
      } catch (err) {
        o.base.log(`claim failed: ${String(err)}`);
        return;
      }
      if (!claimed) return;
      start(claimed);
    }
  }

  const reap = () => {
    try {
      for (const reaped of reapExpired(o.db, timing)) {
        o.base.log(`job ${reaped.jobId}: reaped, ${reaped.outcome}`);
      }
    } catch (err) {
      o.base.log(`reap failed: ${String(err)}`);
    }
  };
  const prune = () => {
    try {
      const pruned = pruneEvents(o.db, timing, o.retentionMs ?? EVENT_RETENTION_MS);
      if (pruned > 0) o.base.log(`pruned ${pruned} events of long-settled jobs`);
    } catch (err) {
      o.base.log(`event prune failed: ${String(err)}`);
    }
  };
  const claimTimer = setInterval(pump, o.claimIdleMs ?? 1000);
  const reapTimer = setInterval(reap, o.reapMs ?? 10_000);
  const pruneTimer = setInterval(prune, o.pruneMs ?? 60 * 60 * 1000);
  reap();
  prune();
  pump();

  return {
    stop: async () => {
      stopping = true;
      clearInterval(claimTimer);
      clearInterval(reapTimer);
      clearInterval(pruneTimer);
      const jobs = [...running.values()];
      for (const job of jobs) {
        job.released = true;
        if (job.phase !== "submitting") lose(job);
      }
      await Promise.all(jobs.map((job) => job.done));
    },
  };
}
