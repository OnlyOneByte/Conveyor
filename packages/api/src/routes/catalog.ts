import type { FastifyInstance, FastifyReply } from "fastify";
import { MAX_ORCA_CONTENT_BYTES } from "@conveyor/shared";
import { z } from "zod";
import {
  openDb,
  dbListPrinters,
  dbUpsertPrinter,
  dbDeletePrinter,
  dbListProfiles,
  dbGetProfile,
  dbGetOrcaProfileDocuments,
  dbSaveOrcaProfileDocuments,
  dbResetOrcaProfileDocuments,
  dbUpsertProfile,
  dbDeleteProfile,
  dbListJobs,
  dbGetJob,
  type Printer,
} from "@conveyor/shared/db";
import { validatePrinterTransport, listTransports } from "../validate.js";
import {
  ProfileContentError,
  readBundledOrcaDocuments,
  validateOrcaDocuments,
} from "../profile-content.js";

/**
 * Catalog + history surface: the durable catalog (printers, profiles) plus the job
 * history. A job names a printer and a profile directly, so there is no saved pairing
 * to curate — these routes are the whole configuration surface.
 * Secrets (printer.secrets) are accepted on write but NEVER returned on read —
 * list responses strip them.
 *
 * Gated together as one surface by registerAuthGuard when CONVEYOR_PASSWORD is set;
 * in the default open mode there is no gate at all.
 */
const printerSchema = z.object({
  id: z.string().min(1).max(128),
  transportId: z.string().min(1),
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(255),
  secrets: z.record(z.string()).optional(),
  /** omit for no restriction; [] allows nothing */
  allowedGenerators: z.array(z.string()).optional(),
});

const profileSchema = z.object({
  id: z.string().min(1).max(128),
  slicerId: z.string().min(1),
  name: z.string().min(1).max(200),
  path: z.string().min(1).max(500),
  gcodeFlavor: z.string().min(1),
});

const orcaDocumentsSchema = z
  .object({
    // Byte limits and file-specific messages are enforced by validateOrcaDocuments;
    // Fastify's bodyLimit rejects grossly oversized requests before this schema.
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

/** Strip server-only secrets before sending a printer to any client. */
function publicPrinter(p: Printer): Omit<Printer, "secrets"> & { hasSecrets: boolean } {
  const { secrets, ...rest } = p;
  return { ...rest, hasSecrets: !!secrets && Object.keys(secrets).length > 0 };
}


function sendProfileContentError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProfileContentError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  reply.log.error({ err: error }, "profile content operation failed");
  return reply.code(500).send({ error: "profile content operation failed" });
}
export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  // ── Job history (settled records from SQLite) ──
  app.get<{ Querystring: { limit?: string } }>("/jobs-history", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    return dbListJobs(openDb(), limit);
  });

  // One settled job, for the /history/[jobId] detail page. 404 is meaningful here:
  // only terminal jobs are recorded (the worker writes on done/failed), so an
  // in-flight or unknown id legitimately has no durable row yet.
  app.get<{ Params: { id: string } }>("/jobs-history/:id", async (req, reply) => {
    const job = dbGetJob(openDb(), req.params.id);
    if (!job) return reply.code(404).send({ error: `no settled job with id ${req.params.id}` });
    return job;
  });

  // ── Printers (secrets stripped on read) ──
  app.get("/catalog/printers", async () => dbListPrinters(openDb()).map(publicPrinter));

  app.put("/catalog/printers", async (req, reply) => {
    const parsed = printerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
    try {
      validatePrinterTransport(parsed.data.transportId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    // Omitting `secrets` preserves the stored value (see dbUpsertPrinter).
    dbUpsertPrinter(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>("/catalog/printers/:id", async (req, reply) => {
    dbDeletePrinter(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
  });

  // ── Transports (capability metadata for the Settings printer form) ──
  app.get("/catalog/transports", async () => listTransports());

  // ── Profiles ──
  app.get("/catalog/profiles", async () => dbListProfiles(openDb()));

  app.put("/catalog/profiles", async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
    dbUpsertProfile(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });

  /**
   * Fetch the raw editor documents. Stored content wins; otherwise read the three
   * fixed filenames from the immutable bundled profile directory.
   */
  app.get<{ Params: { id: string } }>("/catalog/profiles/:id/content", async (req, reply) => {
    const db = openDb();
    const profile = dbGetProfile(db, req.params.id);
    if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
    if (profile.slicerId !== "orca") {
      return reply.code(409).send({ error: "raw profile editing currently supports Orca profiles only" });
    }

    try {
      const edited = dbGetOrcaProfileDocuments(db, profile.id);
      if (edited) return { format: "orca-json" as const, source: "edited" as const, documents: edited };

      const documents = await readBundledOrcaDocuments(profile.path);
      try {
        validateOrcaDocuments(documents);
      } catch (error) {
        if (error instanceof ProfileContentError) {
          throw new ProfileContentError(`bundled ${error.message}`, 409);
        }
        throw error;
      }
      return { format: "orca-json" as const, source: "bundled" as const, documents };
    } catch (error) {
      return sendProfileContentError(reply, error);
    }
  });

  /** Persist validated raw text verbatim. JSON encoding can expand strings, so the
   * parser limit is twice the post-parse 768 KiB content cap. */
  app.put<{ Params: { id: string } }>(
    "/catalog/profiles/:id/content",
    { bodyLimit: MAX_ORCA_CONTENT_BYTES * 2 },
    async (req, reply) => {
      const parsed = orcaContentSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
      const db = openDb();
      const profile = dbGetProfile(db, req.params.id);
      if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
      if (profile.slicerId !== "orca") {
        return reply.code(409).send({ error: "raw profile editing currently supports Orca profiles only" });
      }

      try {
        validateOrcaDocuments(parsed.data.documents);
        if (!dbSaveOrcaProfileDocuments(db, profile.id, parsed.data.documents)) {
          return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
        }
        return reply.code(200).send({ ok: true, source: "edited" });
      } catch (error) {
        return sendProfileContentError(reply, error);
      }
    },
  );

  /** Reset only after proving the bundled fallback is readable and valid. */
  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id/content", async (req, reply) => {
    const db = openDb();
    const profile = dbGetProfile(db, req.params.id);
    if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
    if (profile.slicerId !== "orca") {
      return reply.code(409).send({ error: "raw profile editing currently supports Orca profiles only" });
    }

    try {
      const bundled = await readBundledOrcaDocuments(profile.path);
      validateOrcaDocuments(bundled);
      if (!dbResetOrcaProfileDocuments(db, profile.id)) {
        return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
      }
      return reply.code(200).send({ ok: true, source: "bundled" });
    } catch (error) {
      return sendProfileContentError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id", async (req, reply) => {
    dbDeleteProfile(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
  });
}
