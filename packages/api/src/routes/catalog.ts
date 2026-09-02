import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  openDb,
  dbListStations,
  dbUpsertStation,
  dbDeleteStation,
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
import { validateStation, validatePrinterTransport, listTransports } from "../validate.js";

/**
 * Catalog + history surface. This is where the durable catalog (stations, printers,
 * profiles) is managed; end users never see these routes, they only pick a Station.
 * Secrets (printer.secrets) are accepted on write but NEVER returned on read —
 * list responses strip them.
 *
 * Gated together as one surface by registerAuthGuard when CONVEYOR_PASSWORD is set;
 * in the default open mode there is no gate at all.
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

/**
 * Stations reference printers and profiles by id, but the stations table declares NO
 * foreign keys — `PRAGMA foreign_key_list(stations)` is empty even though
 * PRAGMA foreign_keys is ON — so SQLite will happily delete a row out from under a
 * Station. The Station would then point at nothing, still look fine in Settings, and
 * only blow up later at job submit as a confusing compatibility error. So we refuse
 * the delete here and name the Stations that are in the way.
 */
function referencingStations(field: "printerId" | "profileId", id: string): string[] {
  return dbListStations(openDb())
    .filter((st) => st[field] === id)
    .map((st) => st.name || st.id);
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

  // ── Stations ──
  app.get("/catalog/stations", async () => dbListStations(openDb()));

  app.put("/catalog/stations", async (req, reply) => {
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

  app.delete<{ Params: { id: string } }>("/catalog/stations/:id", async (req, reply) => {
    dbDeleteStation(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
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
    const blockers = referencingStations("printerId", req.params.id);
    if (blockers.length) {
      return reply.code(409).send({
        error: `printer is still used by ${blockers.length} station(s): ${blockers.join(", ")}. Delete or repoint them first.`,
      });
    }
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
    const blockers = referencingStations("profileId", req.params.id);
    if (blockers.length) {
      return reply.code(409).send({
        error: `profile is still used by ${blockers.length} station(s): ${blockers.join(", ")}. Delete or repoint them first.`,
      });
    }
    dbDeleteProfile(openDb(), req.params.id);
    return reply.code(200).send({ ok: true });
  });
}
