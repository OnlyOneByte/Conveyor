import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  jobChannel,
  jobSnapshotKey,
  isTerminal,
  ACTIVE_JOBS_KEY,
  type JobStatusEvent,
} from "@conveyor/shared";
import { jobQueue, redis } from "../queue.js";
import { openDb, dbResolveJobTarget } from "@conveyor/shared/db";
import { validateJobRequest } from "../validate.js";
import {
  resolveJobArtifact,
  openArtifactStream,
  ArtifactError,
  type ArtifactKind,
} from "../artifact-download.js";

const jobRequestSchema = z.object({
  generator: z.object({ id: z.string(), params: z.unknown() }),
  printerId: z.string(),
  profileId: z.string(),
});

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  // Submit a job → validate compatibility → enqueue.
  app.post("/jobs", async (req, reply) => {
    const parsed = jobRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });

    // The pair the request names IS the print target: the printer supplies the
    // transport, the profile supplies the slicer and g-code flavour.
    const target = dbResolveJobTarget(openDb(), parsed.data.printerId, parsed.data.profileId);
    if (!target) {
      return reply
        .code(404)
        .send({ error: `unknown printer ${parsed.data.printerId} or profile ${parsed.data.profileId}` });
    }

    try {
      validateJobRequest(parsed.data, target); // throws CompatibilityError → 400
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }

    const jobId = randomUUID();
    await jobQueue.add("job", parsed.data, { jobId });
    return reply.code(202).send({ jobId });
  });

  // Active jobs: the in-flight set → each job's live snapshot. Ordered newest-first
  // by event time. Registered BEFORE /jobs/:id so "active" is not swallowed as an id.
  // A stale member (worker died mid-job) resolves to a terminal or missing snapshot
  // and is filtered out here — the set is an index, the snapshot is the truth.
  app.get("/jobs/active", async () => {
    const ids = await redis.smembers(ACTIVE_JOBS_KEY);
    if (ids.length === 0) return [];
    const snapshots = await redis.mget(ids.map(jobSnapshotKey));
    const active: JobStatusEvent[] = [];
    const stale: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const raw = snapshots[i];
      if (!raw) {
        stale.push(ids[i]);
        continue;
      }
      const evt = JSON.parse(raw) as JobStatusEvent;
      if (isTerminal(evt.state)) stale.push(ids[i]);
      else active.push(evt);
    }
    // Opportunistically prune members whose snapshot is gone or already terminal so
    // the set self-heals; never fail the read if the prune errors.
    if (stale.length) await redis.srem(ACTIVE_JOBS_KEY, ...stale).catch(() => {});
    return active.sort((a, b) => b.at - a.at);
  });

  // Snapshot (reconnect-safe: PWA re-fetches this on WS reconnect).
  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
    const snapshot = await redis.get(jobSnapshotKey(req.params.id));
    if (!snapshot) return reply.code(404).send({ error: "unknown job" });
    return reply.send(JSON.parse(snapshot));
  });

  // Download a settled job's build artifact (the STL it generated or the gcode it
  // sliced). The only request-supplied surface is the opaque jobId and a fixed kind
  // enum; the path comes from the job's own record and is containment-checked under
  // its work dir (see artifact-download.ts). 404 = unknown/never-produced, 410 = the
  // file was recorded but has since been reaped.
  app.get<{ Params: { id: string; kind: string } }>("/jobs/:id/artifact/:kind", async (req, reply) => {
    const kind = req.params.kind;
    if (kind !== "model" && kind !== "gcode") {
      return reply.code(404).send({ error: `unknown artifact kind ${kind}` });
    }
    try {
      const art = await resolveJobArtifact(req.params.id, kind as ArtifactKind);
      reply
        .header("content-type", art.contentType)
        .header("content-length", art.size)
        .header("content-disposition", `attachment; filename="${art.filename}"`);
      return reply.send(openArtifactStream(art.path));
    } catch (err) {
      if (err instanceof ArtifactError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
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
