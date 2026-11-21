import { randomUUID } from "node:crypto";
import {
  ACTIVE_JOBS_KEY,
  CANCEL_TTL_SECONDS,
  isTerminal,
  type JobStatusEvent,
  jobCancelKey,
  jobChannel,
  jobControlChannel,
  jobSnapshotKey,
  parseStatusEvent,
  publishStatus,
} from "@conveyor/shared";
import { dbRecordJob, dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ArtifactError,
  type ArtifactKind,
  openArtifactStream,
  resolveJobArtifact,
} from "../artifact-download.js";
import { cancelJob } from "../cancel.js";
import { jobQueue, redis } from "../queue.js";
import { validateJobRequest } from "../validate.js";

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
      return reply.code(404).send({
        error: `unknown printer ${parsed.data.printerId} or profile ${parsed.data.profileId}`,
      });
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
      const evt = parseStatusEvent(snapshots[i]);
      if (!evt || isTerminal(evt.state)) stale.push(ids[i]);
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
  app.get<{ Params: { id: string; kind: string } }>(
    "/jobs/:id/artifact/:kind",
    async (req, reply) => {
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
        if (err instanceof ArtifactError)
          return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req, reply) => {
    const result = await cancelJob(req.params.id, {
      getJob: (id) => jobQueue.getJob(id),
      readSnapshot: async (id) => parseStatusEvent(await redis.get(jobSnapshotKey(id))),
      requestCancel: async (id) => {
        await redis
          .multi()
          .set(jobCancelKey(id), "1", "EX", CANCEL_TTL_SECONDS)
          .publish(jobControlChannel(id), "cancel")
          .exec();
      },
      settleCanceled: async (id, request) => {
        const written = await publishStatus(redis, {
          jobId: id,
          state: "canceled",
          at: Date.now(),
        });
        if (written) {
          dbRecordJob(openDb(), {
            id,
            generatorId: request.generator.id,
            params: request.generator.params,
            printerId: request.printerId,
            profileId: request.profileId,
            state: "canceled",
          });
        }
        return written;
      },
    });
    return reply.code(result.code).send(result.body);
  });

  // Live status: subscribe to the job's Redis channel, forward frames verbatim.
  app.get<{ Params: { id: string } }>("/jobs/:id/ws", { websocket: true }, (socket, req) => {
    const channel = jobChannel(req.params.id);
    const sub = redis.duplicate();

    void sub.subscribe(channel);
    sub.on("message", (_chan, payload) => {
      socket.send(payload);
      const evt = parseStatusEvent(payload);
      if (evt && isTerminal(evt.state)) socket.close();
    });

    socket.on("close", () => void sub.quit());
  });
}
