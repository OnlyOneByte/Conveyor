import type { FastifyInstance, FastifyReply } from "fastify";
import { MAX_ORCA_CONTENT_BYTES, MAX_PRUSA_DOCUMENT_BYTES, slicerFormat } from "@conveyor/shared";
import { z } from "zod";
import {
  openDb,
  dbListPrinters,
  dbUpsertPrinter,
  dbDeletePrinter,
  dbGetPrinter,
  dbListProfiles,
  dbGetProfile,
  dbGetOrcaProfileDocuments,
  dbSaveOrcaProfileDocuments,
  dbResetOrcaProfileDocuments,
  dbGetPrusaProfileContent,
  dbSavePrusaProfileContent,
  dbResetPrusaProfileContent,
  dbUpsertProfile,
  dbDeleteProfile,
  dbListJobs,
  dbGetJob,
  type Printer,
} from "@conveyor/shared/db";
import { validatePrinterTransport, listTransports } from "../validate.js";
import { probePrinter } from "../printer-probe.js";
import {
  ProfileContentError,
  readBundledOrcaDocuments,
  validateOrcaDocuments,
  readBundledPrusaConfig,
  validatePrusaContent,
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

const prusaContentSchema = z
  .object({
    format: z.literal("prusa-ini"),
    // Byte limit + structure enforced by validatePrusaContent; Fastify's bodyLimit
    // rejects grossly oversized requests before this schema.
    document: z.object({ config: z.string() }).strict(),
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

  // Liveness probe: TCP-connect the printer's address. A monitoring view calls this
  // to show reachability without a transport-specific health call or any secret.
  // 404 for an unknown printer; otherwise 200 with the probe result (reachable may
  // be false — that is a successful probe of an offline printer, not an error).
  app.get<{ Params: { id: string } }>("/catalog/printers/:id/reachable", async (req, reply) => {
    const printer = dbGetPrinter(openDb(), req.params.id);
    if (!printer) return reply.code(404).send({ error: `unknown printer ${req.params.id}` });
    const result = await probePrinter(printer.address, printer.transportId);
    return reply.send(result);
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
   * Fetch the raw editor documents. Stored content wins; otherwise read the bundled
   * profile. Dispatches on the profile's slicer format — Orca serves three JSON
   * documents, Prusa serves one config.ini; a slicer with no editable format 409s.
   */
  app.get<{ Params: { id: string } }>("/catalog/profiles/:id/content", async (req, reply) => {
    const db = openDb();
    const profile = dbGetProfile(db, req.params.id);
    if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
    const format = slicerFormat(profile.slicerId);
    if (format === null) {
      return reply.code(409).send({ error: `raw editing is not supported for ${profile.slicerId} profiles` });
    }

    try {
      if (format === "orca-json") {
        const edited = dbGetOrcaProfileDocuments(db, profile.id);
        if (edited) return { format: "orca-json" as const, source: "edited" as const, documents: edited };
        const documents = await readBundledOrcaDocuments(profile.path);
        try {
          validateOrcaDocuments(documents);
        } catch (error) {
          if (error instanceof ProfileContentError) throw new ProfileContentError(`bundled ${error.message}`, 409);
          throw error;
        }
        return { format: "orca-json" as const, source: "bundled" as const, documents };
      }
      // prusa-ini
      const edited = dbGetPrusaProfileContent(db, profile.id);
      if (edited) return { format: "prusa-ini" as const, source: "edited" as const, document: edited };
      const document = await readBundledPrusaConfig(profile.path);
      return { format: "prusa-ini" as const, source: "bundled" as const, document };
    } catch (error) {
      return sendProfileContentError(reply, error);
    }
  });

  /** Persist validated raw text verbatim. bodyLimit covers the larger of the two
   * formats (Orca's 768 KiB post-parse content, doubled for JSON string expansion,
   * vs Prusa's 512 KiB config). */
  app.put<{ Params: { id: string } }>(
    "/catalog/profiles/:id/content",
    { bodyLimit: Math.max(MAX_ORCA_CONTENT_BYTES * 2, MAX_PRUSA_DOCUMENT_BYTES * 2) },
    async (req, reply) => {
      const db = openDb();
      const profile = dbGetProfile(db, req.params.id);
      if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
      const format = slicerFormat(profile.slicerId);
      if (format === null) {
        return reply.code(409).send({ error: `raw editing is not supported for ${profile.slicerId} profiles` });
      }

      try {
        if (format === "orca-json") {
          const parsed = orcaContentSchema.safeParse(req.body);
          if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
          validateOrcaDocuments(parsed.data.documents);
          if (!dbSaveOrcaProfileDocuments(db, profile.id, parsed.data.documents)) {
            return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
          }
          return reply.code(200).send({ ok: true, source: "edited" });
        }
        // prusa-ini
        const parsed = prusaContentSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
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

  /** Reset only after proving the bundled fallback is readable and valid. */
  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id/content", async (req, reply) => {
    const db = openDb();
    const profile = dbGetProfile(db, req.params.id);
    if (!profile) return reply.code(404).send({ error: `unknown profile ${req.params.id}` });
    const format = slicerFormat(profile.slicerId);
    if (format === null) {
      return reply.code(409).send({ error: `raw editing is not supported for ${profile.slicerId} profiles` });
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
      // prusa-ini: prove the bundled config is readable + valid before clearing.
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

  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id", async (req, reply) => {
    dbDeleteProfile(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
  });
}
