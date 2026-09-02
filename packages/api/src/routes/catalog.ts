import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  openDb,
  dbListPrinters,
  dbUpsertPrinter,
  dbDeletePrinter,
  dbListProfiles,
  dbUpsertProfile,
  dbDeleteProfile,
  dbListJobs,
  dbGetJob,
  type Printer,
} from "@conveyor/shared/db";
import { validatePrinterTransport, listTransports } from "../validate.js";

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
});

const profileSchema = z.object({
  id: z.string().min(1).max(128),
  slicerId: z.string().min(1),
  name: z.string().min(1).max(200),
  path: z.string().min(1).max(500),
  gcodeFlavor: z.string().min(1),
});

/** Strip server-only secrets before sending a printer to any client. */
function publicPrinter(p: Printer): Omit<Printer, "secrets"> & { hasSecrets: boolean } {
  const { secrets, ...rest } = p;
  return { ...rest, hasSecrets: !!secrets && Object.keys(secrets).length > 0 };
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

  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id", async (req, reply) => {
    dbDeleteProfile(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
  });
}
