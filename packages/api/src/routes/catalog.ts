import { isTerminal } from "@conveyor/shared";
import {
  DEFAULT_PROFILES,
  dbCountJobs,
  dbDeletePrinter,
  dbDeleteProfile,
  dbGetJob,
  dbGetPrinter,
  dbGetProfile,
  dbListJobs,
  dbListPrinters,
  dbListProfiles,
  dbUpsertPrinter,
  dbUpsertProfile,
  openDb,
} from "@conveyor/shared/db";
import type { FastifyInstance } from "fastify";
import { parsePrinter, parseProfile } from "../catalog-validation.js";
import { historyCountQuery, historyPageQuery } from "../history-query.js";
import type { JobReference, LiveJobCounter } from "../live-jobs.js";
import { probePrinter } from "../printer-probe.js";
import { describeIssues, listTransports } from "../validate.js";
import { registerProfileContentRoutes } from "./catalog-content.js";

const BUNDLED_PROFILE_IDS: ReadonlySet<string> = new Set(DEFAULT_PROFILES.map((p) => p.id));

async function inUseError(
  liveJobs: LiveJobCounter,
  reference: JobReference,
  id: string,
): Promise<string | null> {
  const count = await liveJobs(reference, id);
  const noun = reference === "printerId" ? "printer" : "profile";
  return count > 0 ? `${noun} ${id} is used by ${count} queued or running job(s)` : null;
}

export async function registerCatalogRoutes(
  app: FastifyInstance,
  liveJobs: LiveJobCounter,
): Promise<void> {
  app.get("/jobs-history", async (req, reply) => {
    const parsed = historyPageQuery.safeParse(req.query);
    if (!parsed.success)
      return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
    return dbListJobs(openDb(), parsed.data);
  });

  app.get("/jobs-history/counts", async (req, reply) => {
    const parsed = historyCountQuery.safeParse(req.query);
    if (!parsed.success)
      return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
    return dbCountJobs(openDb(), parsed.data);
  });

  app.get<{ Params: { id: string } }>("/jobs-history/:id", async (req, reply) => {
    const job = dbGetJob(openDb(), req.params.id);
    if (!job || !isTerminal(job.state)) {
      return reply.code(404).send({ error: `no settled job with id ${req.params.id}` });
    }
    return job;
  });

  app.get("/catalog/printers", async () => dbListPrinters(openDb()));

  app.put("/catalog/printers", async (req, reply) => {
    const parsed = parsePrinter(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
    dbUpsertPrinter(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>("/catalog/printers/:id", async (req, reply) => {
    const { id } = req.params;
    if (!dbGetPrinter(openDb(), id))
      return reply.code(404).send({ error: `unknown printer ${id}` });
    const inUse = await inUseError(liveJobs, "printerId", id);
    if (inUse) return reply.code(409).send({ error: inUse });
    dbDeletePrinter(openDb(), id);
    return reply.code(200).send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/catalog/printers/:id/reachable", async (req, reply) => {
    const printer = dbGetPrinter(openDb(), req.params.id);
    if (!printer) return reply.code(404).send({ error: `unknown printer ${req.params.id}` });
    const result = await probePrinter(printer.address, printer.transportId);
    return reply.send(result);
  });

  app.get("/catalog/transports", async () => listTransports());

  app.get("/catalog/profiles", async () => dbListProfiles(openDb()));

  app.put("/catalog/profiles", async (req, reply) => {
    const parsed = parseProfile(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
    dbUpsertProfile(openDb(), parsed.data);
    return reply.code(200).send({ ok: true });
  });

  registerProfileContentRoutes(app);

  app.delete<{ Params: { id: string } }>("/catalog/profiles/:id", async (req, reply) => {
    const { id } = req.params;
    if (!dbGetProfile(openDb(), id))
      return reply.code(404).send({ error: `unknown profile ${id}` });
    if (BUNDLED_PROFILE_IDS.has(id)) {
      return reply.code(409).send({ error: `profile ${id} is bundled and cannot be deleted` });
    }
    const inUse = await inUseError(liveJobs, "profileId", id);
    if (inUse) return reply.code(409).send({ error: inUse });
    dbDeleteProfile(openDb(), id);
    return reply.code(200).send({ ok: true });
  });
}
