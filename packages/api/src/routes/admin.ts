import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  openDb,
  dbListStations,
  dbUpsertStation,
  dbDeleteStation,
  dbListPrinters,
  dbUpsertPrinter,
  dbListProfiles,
  dbUpsertProfile,
  dbListJobs,
  type Printer,
} from "@conveyor/shared/db";
import { validateStation } from "../validate.js";

/**
 * Admin + history surface. The admin (you) manages the durable catalog here;
 * end users never see these routes. Secrets (printer.secrets) are accepted on
 * write but NEVER returned on read — list responses strip them.
 *
 * NOTE: these routes are unauthenticated until the auth slice lands (SPEC open
 * decision). The whole /admin surface is gated together at that point.
 */
const stationSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  transportId: z.string().min(1),
  printerId: z.string().min(1),
  slicerId: z.string().min(1),
  profileId: z.string().min(1),
  allowedGenerators: z.array(z.string()).optional(),
});

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

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // ── Job history (settled records from SQLite) ──
  app.get<{ Querystring: { limit?: string } }>("/jobs-history", async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    return dbListJobs(openDb(), limit);
  });

  // ── Stations ──
  app.get("/admin/stations", async () => dbListStations(openDb()));

  app.put("/admin/stations", async (req, reply) => {
    const parsed = stationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
    try {
      validateStation(parsed.data); // capability check before persisting
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    dbUpsertStation(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>("/admin/stations/:id", async (req, reply) => {
    dbDeleteStation(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
  });

  // ── Printers (secrets stripped on read) ──
  app.get("/admin/printers", async () => dbListPrinters(openDb()).map(publicPrinter));

  app.put("/admin/printers", async (req, reply) => {
    const parsed = printerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
    dbUpsertPrinter(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });

  // ── Profiles ──
  app.get("/admin/profiles", async () => dbListProfiles(openDb()));

  app.put("/admin/profiles", async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.format() });
    dbUpsertProfile(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });
}
