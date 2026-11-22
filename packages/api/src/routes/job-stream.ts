import { isTerminal, JOB_STREAM_CLOSE, jobChannel, parseStatusEvent } from "@conveyor/shared";
import type { FastifyInstance } from "fastify";
import type { StatusHub } from "../status-hub.js";

export interface JobStreamLimits {
  buffered: number;
  readMs: number;
}

export interface JobStreamDeps {
  hub: StatusHub;
  snapshot(jobId: string): Promise<string | null>;
  queued(jobId: string): Promise<boolean>;
  limits?: JobStreamLimits;
}

export const DEFAULT_STREAM_LIMITS: JobStreamLimits = { buffered: 256, readMs: 5000 };

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const seqOf = (payload: string) => parseStatusEvent(payload)?.seq ?? 0;

function withTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`job stream read took over ${ms} ms`)), ms);
  });
  return Promise.race([read, late]).finally(() => clearTimeout(timer));
}

export function registerJobStream(app: FastifyInstance, deps: JobStreamDeps): void {
  const limits = deps.limits ?? DEFAULT_STREAM_LIMITS;
  app.get<{ Params: { id: string } }>("/jobs/:id/ws", { websocket: true }, async (socket, req) => {
    const jobId = req.params.id;
    if (!JOB_ID.test(jobId)) return socket.close(JOB_STREAM_CLOSE.unknownJob, "unknown job");
    let open = true;
    let live = false;
    let stop: (() => void) | undefined;
    const buffered: string[] = [];

    const finish = (code: number, reason: string) => {
      if (!open) return;
      open = false;
      stop?.();
      socket.close(code, reason);
    };
    const forward = (payload: string) => {
      if (!open) return;
      socket.send(payload);
      const state = parseStatusEvent(payload)?.state;
      if (state && isTerminal(state)) finish(JOB_STREAM_CLOSE.finished, "job finished");
    };
    socket.on("close", () => {
      open = false;
      stop?.();
    });

    try {
      stop = await deps.hub.watch(jobChannel(jobId), (payload) => {
        if (live) forward(payload);
        else if (buffered.push(payload) > limits.buffered) {
          req.log.error({ jobId }, "job stream buffer overflowed before the snapshot");
          finish(JOB_STREAM_CLOSE.failed, "job stream failed");
        }
      });
      if (!open) return stop();
      const snapshot = await withTimeout(deps.snapshot(jobId), limits.readMs);
      if (!snapshot && !(await withTimeout(deps.queued(jobId), limits.readMs))) {
        return finish(JOB_STREAM_CLOSE.unknownJob, "unknown job");
      }
      if (snapshot) forward(snapshot);
      live = true;
      const after = snapshot ? seqOf(snapshot) : 0;
      for (const payload of buffered.splice(0)) if (seqOf(payload) > after) forward(payload);
    } catch (err) {
      req.log.error({ err, jobId }, "job stream failed");
      finish(JOB_STREAM_CLOSE.failed, "job stream failed");
    }
  });
}
