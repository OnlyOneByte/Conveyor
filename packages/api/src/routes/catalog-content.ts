import { MAX_ORCA_CONTENT_BYTES, MAX_PRUSA_DOCUMENT_BYTES, slicerFormat } from "@conveyor/shared";
import {
  dbGetOrcaProfileDocuments,
  dbGetProfile,
  dbGetPrusaProfileContent,
  dbResetOrcaProfileDocuments,
  dbResetPrusaProfileContent,
  dbSaveOrcaProfileDocuments,
  dbSavePrusaProfileContent,
  openDb,
} from "@conveyor/shared/db";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  ProfileContentError,
  readBundledOrcaDocuments,
  readBundledPrusaConfig,
  validateOrcaDocuments,
  validatePrusaContent,
} from "../profile-content.js";
import { describeIssues } from "../validate.js";

const orcaDocumentsSchema = z
  .object({
    machine: z.string(),
    process: z.string(),
    filament: z.string(),
  })
  .strict();

const orcaContentSchema = z
  .object({
    format: z.literal("orca-json"),
    documents: orcaDocumentsSchema,
  })
  .strict();

const prusaContentSchema = z
  .object({
    format: z.literal("prusa-ini"),
    document: z.object({ config: z.string() }).strict(),
  })
  .strict();

function sendProfileContentError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProfileContentError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  reply.log.error({ err: error }, "profile content operation failed");
  return reply.code(500).send({ error: "profile content operation failed" });
}

export function registerProfileContentRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/catalog/profiles/:id/content", async (req, reply) => {
    const db = openDb();
    const profile = dbGetProfile(db, req.params.id);
    if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
    const format = slicerFormat(profile.slicerId);
    if (format === null) {
      return reply
        .code(409)
        .send({ error: `raw editing is not supported for ${profile.slicerId} profiles` });
    }

    try {
      if (format === "orca-json") {
        const edited = dbGetOrcaProfileDocuments(db, profile.id);
        if (edited)
          return { format: "orca-json" as const, source: "edited" as const, documents: edited };
        const documents = await readBundledOrcaDocuments(profile.path);
        try {
          validateOrcaDocuments(documents);
        } catch (error) {
          if (error instanceof ProfileContentError)
            throw new ProfileContentError(`bundled ${error.message}`, 409);
          throw error;
        }
        return { format: "orca-json" as const, source: "bundled" as const, documents };
      }
      const edited = dbGetPrusaProfileContent(db, profile.id);
      if (edited)
        return { format: "prusa-ini" as const, source: "edited" as const, document: edited };
      const document = await readBundledPrusaConfig(profile.path);
      return { format: "prusa-ini" as const, source: "bundled" as const, document };
    } catch (error) {
      return sendProfileContentError(reply, error);
    }
  });

  app.put<{ Params: { id: string } }>(
    "/catalog/profiles/:id/content",
    { bodyLimit: Math.max(MAX_ORCA_CONTENT_BYTES * 2, MAX_PRUSA_DOCUMENT_BYTES * 2) },
    async (req, reply) => {
      const db = openDb();
      const profile = dbGetProfile(db, req.params.id);
      if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
      const format = slicerFormat(profile.slicerId);
      if (format === null) {
        return reply
          .code(409)
          .send({ error: `raw editing is not supported for ${profile.slicerId} profiles` });
      }

      try {
        if (format === "orca-json") {
          const parsed = orcaContentSchema.safeParse(req.body);
          if (!parsed.success) {
            return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
          }
          validateOrcaDocuments(parsed.data.documents);
          if (!dbSaveOrcaProfileDocuments(db, profile.id, parsed.data.documents)) {
            return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
          }
          return reply.code(200).send({ ok: true, source: "edited" });
        }
        const parsed = prusaContentSchema.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
        }
        validatePrusaContent(parsed.data.document);
        if (!dbSavePrusaProfileContent(db, profile.id, parsed.data.document)) {
          return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
        }
        return reply.code(200).send({ ok: true, source: "edited" });
      } catch (error) {
        return sendProfileContentError(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id/content", async (req, reply) => {
    const db = openDb();
    const profile = dbGetProfile(db, req.params.id);
    if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
    const format = slicerFormat(profile.slicerId);
    if (format === null) {
      return reply
        .code(409)
        .send({ error: `raw editing is not supported for ${profile.slicerId} profiles` });
    }

    try {
      if (format === "orca-json") {
        const bundled = await readBundledOrcaDocuments(profile.path);
        validateOrcaDocuments(bundled);
        if (!dbResetOrcaProfileDocuments(db, profile.id)) {
          return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
        }
        return reply.code(200).send({ ok: true, source: "bundled" });
      }
      const bundled = await readBundledPrusaConfig(profile.path);
      validatePrusaContent(bundled);
      if (!dbResetPrusaProfileContent(db, profile.id)) {
        return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
      }
      return reply.code(200).send({ ok: true, source: "bundled" });
    } catch (error) {
      return sendProfileContentError(reply, error);
    }
  });
}
