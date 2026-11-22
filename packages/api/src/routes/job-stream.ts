import { isTerminal, JOB_STREAM_CLOSE, jobChannel, parseStatusEvent } from "@conveyor/shared";
import type { FastifyInstance } from "fastify";
import type { StatusHub } from "../status-hub.js";

export interface JobStreamDeps {
  hub: StatusHub;
  snapshot(jobId: string): Promise<string | null>;
  queued(jobId: string): Promise<boolean>;
}

export function registerJobStream(app: FastifyInstance, deps: JobStreamDeps): void {
  app.get<{ Params: { id: string } }>("/jobs/:id/ws", { websocket: true }, async (socket, req) => {
    const jobId = req.params.id;
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
        else buffered.push(payload);
      });
      if (!open) return stop();
      const snapshot = await deps.snapshot(jobId);
      if (!snapshot && !(await deps.queued(jobId))) {
        return finish(JOB_STREAM_CLOSE.unknownJob, "unknown job");
      }
      if (snapshot) forward(snapshot);
      live = true;
      const seen = snapshot ? buffered.lastIndexOf(snapshot) : -1;
      for (const payload of buffered.splice(0).slice(seen + 1)) forward(payload);
    } catch (err) {
      req.log.error({ err, jobId }, "job stream failed");
      finish(JOB_STREAM_CLOSE.failed, "job stream failed");
    }
  });
}
