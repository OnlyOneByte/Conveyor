import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  jobChannel,
  jobSnapshotKey,
  isTerminal,
  type JobStatusEvent,
} from "@conveyor/shared";
import { jobQueue, redis } from "../queue.js";
import { getStation } from "../stations-store.js";
import { validateJobRequest } from "../validate.js";

const jobRequestSchema = z.object({
  generator: z.object({ id: z.string(), params: z.unknown() }),
  stationId: z.string(),
});

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  // Submit a job → validate compatibility → enqueue.
  app.post("/jobs", async (req, reply) => {
    const parsed = jobRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });

    const station = await getStation(parsed.data.stationId);
    if (!station) return reply.code(404).send({ error: "unknown station" });

    try {
      validateJobRequest(parsed.data, station); // throws CompatibilityError → 400
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const jobId = randomUUID();
    await jobQueue.add("job", parsed.data, { jobId });
    return reply.code(202).send({ jobId });
  });

  // Snapshot (reconnect-safe: PWA re-fetches this on WS reconnect).
  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const snapshot = await redis.get(jobSnapshotKey(req.params.id));
    if (!snapshot) return reply.code(404).send({ error: "unknown job" });
    return reply.send(JSON.parse(snapshot));
  });

  // Cancel.
  app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req, reply) => {
    await redis.publish(`job:${req.params.id}:control`, "cancel");
    const job = await jobQueue.getJob(req.params.id);
    if (job && (await job.isWaiting())) await job.remove();
    return reply.send({ ok: true });
  });

  // Live status: subscribe to the job's Redis channel, forward frames verbatim.
  app.get<{ Params: { id: string } }>("/jobs/:id/ws", { websocket: true }, (socket, req) => {
    const channel = jobChannel(req.params.id);
    const sub = redis.duplicate();

    void sub.subscribe(channel);
    sub.on("message", (_chan, payload) => {
      socket.send(payload);
      const evt = JSON.parse(payload) as JobStatusEvent;
      if (isTerminal(evt.state)) socket.close();
    });

    socket.on("close", () => void sub.quit());
  });
}
