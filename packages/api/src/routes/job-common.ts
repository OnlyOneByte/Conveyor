import { type JobRequest, jobRequestSchema } from "@conveyor/shared";
import { dbResolveJobTarget, openDb } from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import {
  ArtifactError,
  type ArtifactKind,
  openArtifactStream,
  resolveJobArtifact,
} from "../artifact-download.js";
import { parseGeneratorParams, validateJobRequest } from "../validate.js";

type Submission =
  | { ok: true; request: JobRequest }
  | { ok: false; code: 400 | 404; error: unknown };

export function parseSubmission(body: unknown): Submission {
  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: 400, error: parsed.error.format() };
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
