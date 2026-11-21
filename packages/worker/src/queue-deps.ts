import type { Database } from "bun:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { isTerminal, StageError } from "@conveyor/shared";
import {
  DEFAULT_TIMING,
  FENCE,
  fenceOf,
  inImmediate,
  isCancelRequested,
  type Lease,
  markSubmitted,
  type QueueTiming,
  requestCancel,
  type StatusUpdate,
  settleCancel,
  takePrinterSlot,
  writeStatus,
} from "@conveyor/shared/queue";
import { LeaseLostError, type PipelineDeps, type TerminalState } from "./run.js";

export const PROGRESS_FLUSH_MS = 1000;
export const SLOT_RETRY_MS = 1000;
export const SLOT_WAIT_MESSAGE = "sliced; waiting for the printer";

export interface QueueDepsOptions {
  db: Database;
  lease: Lease;
  controller: AbortController;
  log(msg: string): void;
  timing?: QueueTiming;
  progressFlushMs?: number;
  slotRetryMs?: number;
}

export interface QueueDeps {
  deps: Pick<PipelineDeps, "publish" | "record" | "cancelRequested" | "queue">;
  dispose(): void;
}

export function queueDeps(o: QueueDepsOptions): QueueDeps {
  const { db, lease, controller } = o;
  const timing = o.timing ?? DEFAULT_TIMING;
  const flushMs = o.progressFlushMs ?? PROGRESS_FLUSH_MS;
  let last: StatusUpdate | undefined;
  let lastAt = Number.NEGATIVE_INFINITY;
  let pending: StatusUpdate | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const lose = (): LeaseLostError => {
    const err = new LeaseLostError();
    if (!controller.signal.aborted) controller.abort(err);
    return err;
  };
  const dispose = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const write = (update: StatusUpdate): boolean => {
    last = update;
    lastAt = Date.now();
    const written = writeStatus(db, lease, update, timing);
    if (!written && !isTerminal(update.state)) lose();
    return written;
  };
  const flush = () => {
    timer = undefined;
    const update = pending;
    pending = undefined;
    if (!update) return;
    try {
      write(update);
    } catch (err) {
      o.log(`progress write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const publish: PipelineDeps["publish"] = async (_jobId, state, extra = {}) => {
    const update: StatusUpdate = { state, ...extra };
    const sameStep = !isTerminal(state) && last?.state === state && last.stage === update.stage;
    if (sameStep && Date.now() - lastAt < flushMs) {
      pending = update;
      timer ??= setTimeout(flush, lastAt + flushMs - Date.now());
      return true;
    }
    dispose();
    if (!write(update) && isTerminal(state)) throw lose();
    return true;
  };

  return {
    dispose,
    deps: {
      publish,
      record: (_jobId, _req, outcome) => {
        inImmediate(db, timing.now, (at) =>
          db
            .query(
              `UPDATE jobs SET model_path = $model, gcode_path = $gcode, notes = $notes,
                 message = $notes, progress = NULL, stage = COALESCE($stage, stage),
                 timings_json = COALESCE($timings, timings_json) WHERE ${FENCE}`,
            )
            .run({
              ...fenceOf(lease, at),
              $model: outcome.modelPath ?? null,
              $gcode: outcome.gcodePath ?? null,
              $notes: outcome.notes ?? null,
              $stage: outcome.stage ?? null,
              $timings: outcome.timings?.length ? JSON.stringify(outcome.timings) : null,
            }),
        );
      },
      cancelRequested: async () => isCancelRequested(db, lease.jobId),
      queue: {
        takeSlot: async (signal) => {
          let waiting = false;
          while (true) {
            const outcome = takePrinterSlot(db, lease, timing);
            if (outcome === "taken" || outcome === "canceled") return outcome;
            if (outcome === "lost") throw lose();
            if (outcome === "refused") throw new StageError("transport", "printer slot refused");
            if (!waiting) {
              waiting = true;
              dispose();
              write({ state: "slicing", stage: "slicer", progress: 1, message: SLOT_WAIT_MESSAGE });
            }
            await delay(o.slotRetryMs ?? SLOT_RETRY_MS, undefined, { signal }).catch(() => {});
            if (signal.aborted) return "canceled";
          }
        },
        markSubmitted: async (handle) => {
          dispose();
          if (!markSubmitted(db, lease, handle, timing)) throw lose();
        },
        settleCancel: async (stopConfirmed): Promise<TerminalState> => {
          dispose();
          requestCancel(db, lease.jobId, timing);
          const state = settleCancel(db, lease, stopConfirmed, timing);
          if (state !== "canceled" && state !== "failed") throw lose();
          return state;
        },
      },
    },
  };
}
