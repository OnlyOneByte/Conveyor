import { exhaustive, type JobRequest, jobRequestSchema } from "@conveyor/shared";
import {
  dbDismissJob,
  dbListNeedsYou,
  dbResolveJobTarget,
  dbRetryProblem,
  openDb,
} from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ArtifactError,
  type ArtifactKind,
  openArtifactStream,
  resolveJobArtifact,
} from "../artifact-download.js";
import { describeIssues, parseGeneratorParams, validateJobRequest } from "../validate.js";

type Submission =
  | { ok: true; request: JobRequest; retryOf?: string }
  | { ok: false; code: 400 | 404; error: string };

const retrySchema = z.object({ retryOf: z.string().min(1).max(200).optional() });

export function parseSubmission(body: unknown): Submission {
  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 400, error: describeIssues(parsed.error.issues) };
  const retry = retrySchema.safeParse(body);
  if (!retry.success) return { ok: false, code: 400, error: describeIssues(retry.error.issues) };
  const retryOf = retry.data.retryOf;
  const problem = retryOf === undefined ? null : dbRetryProblem(openDb(), retryOf);
  if (problem) return { ok: false, code: 400, error: problem };
  const target = dbResolveJobTarget(openDb(), parsed.data.printerId, parsed.data.profileId);
  if (!target) {
    return {
      ok: false,
      code: 404,
      error: `unknown printer ${parsed.data.printerId} or profile ${parsed.data.profileId}`,
    };
  }
  try {
    validateJobRequest(parsed.data, target);
  } catch (err) {
    return { ok: false, code: 400, error: (err as Error).message };
  }
  const params = parseGeneratorParams(parsed.data);
  if (!params.ok) return { ok: false, code: 400, error: params.error };
  return {
    ok: true,
    request: { ...parsed.data, generator: { ...parsed.data.generator, params: params.params } },
    retryOf,
  };
}

export function registerArtifactRoute(app: FastifyInstance): void {
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
}

export function registerNeedsYouRoutes(app: FastifyInstance, now: () => number = Date.now): void {
  app.get("/jobs/needs-you", async () => dbListNeedsYou(openDb()));

  app.post<{ Params: { id: string } }>("/jobs/:id/dismiss", async (req, reply) => {
    const jobId = req.params.id;
    const result = dbDismissJob(openDb(), jobId, now());
    switch (result.kind) {
      case "dismissed":
        return reply.send({ ok: true, jobId, dismissedAt: result.dismissedAt });
      case "not-failed":
        return reply.code(409).send({
          ok: false,
          jobId,
          error: `only a failed job can be dismissed; it is ${result.state}`,
        });
      case "unknown":
        return reply.code(404).send({ ok: false, jobId, error: "unknown job" });
      default:
        return exhaustive(result);
    }
  });
}
