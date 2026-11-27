import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DAY_MS, isTerminal, type Job, retentionDays } from "@conveyor/shared";
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
  dbRecordPrinterCheck,
  dbUpsertPrinter,
  dbUpsertProfile,
  openDb,
  PrinterSecretsWriteError,
  type Profile,
} from "@conveyor/shared/db";
import { checkPrinterAddress, PrinterAddressRefusedError } from "@conveyor/shared/node";
import type { FastifyInstance } from "fastify";
import { engineLogPath } from "../artifact-download.js";
import { parsePrinter, parseProfile, printerIssueField } from "../catalog-validation.js";
import { historyCountQuery, historyPageQuery } from "../history-query.js";
import type { JobReference, LiveJobCounter } from "../live-jobs.js";
import { probePrinter } from "../printer-probe.js";
import { profileVolume } from "../profile-content.js";
import { describeIssues, listSlicers, listTransports } from "../validate.js";
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
    return withRemovedFiles(withEngineLog(job));
  });

  app.get("/catalog/printers", async () => dbListPrinters(openDb()));

  app.put("/catalog/printers", async (req, reply) => {
    const parsed = parsePrinter(req.body);
    if (!parsed.success) {
      const { issues } = parsed.error;
      const field = printerIssueField(issues);
      return reply.code(400).send({ error: describeIssues(issues), ...(field ? { field } : {}) });
    }
    const refused = await refusal(parsed.data.address);
    if (refused) return reply.code(400).send({ error: refused, field: "address" });
    try {
      dbUpsertPrinter(openDb(), parsed.data);
    } catch (err) {
      if (!(err instanceof PrinterSecretsWriteError)) throw err;
      const code = err.kind === "TooManySecrets" ? 400 : 409;
      return reply.code(code).send({ error: err.message, field: "secrets" });
    }
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
    const refused = await refusal(printer.address);
    if (refused) return reply.code(400).send({ error: refused });
    const result = await probePrinter(printer.address, printer.transportId);
    dbRecordPrinterCheck(openDb(), printer.id, { at: Date.now(), reachable: result.reachable });
    return reply.send(result);
  });

  app.get("/catalog/transports", async () => listTransports());

  app.get("/catalog/slicers", async () => listSlicers());

  app.get("/catalog/profiles", async (req) => {
    const db = openDb();
    const volumeOf = (p: Profile) =>
      profileVolume(db, p).catch((err: unknown) => {
        req.log.error({ err, profileId: p.id }, "profile print volume unreadable");
        return null;
      });
    return Promise.all(
      dbListProfiles(db).map(async (p) => ({
        ...p,
        bundled: BUNDLED_PROFILE_IDS.has(p.id),
        volume: (await volumeOf(p)) ?? undefined,
      })),
    );
  });

  app.put("/catalog/profiles", async (req, reply) => {
    const parsed = parseProfile(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: describeIssues(parsed.error.issues) });
    const shipped = BUNDLED_PROFILE_IDS.has(parsed.data.id)
      ? dbGetProfile(openDb(), parsed.data.id)
      : null;
    const fields = ["name", "slicerId", "path", "gcodeFlavor"] as const;
    if (shipped && fields.some((field) => shipped[field] !== parsed.data[field])) {
      return reply.code(409).send({
        error: `profile ${parsed.data.id} is bundled, so its name, slicer, folder and firmware can't change`,
      });
    }
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

async function refusal(address: string): Promise<string | undefined> {
  try {
    await checkPrinterAddress(address);
    return undefined;
  } catch (err) {
    if (err instanceof PrinterAddressRefusedError) return err.message;
    throw err;
  }
}

function withEngineLog(job: Job): Job {
  const log = engineLogPath(job.id);
  if (!isTerminal(job.state) || !existsSync(log)) return job;
  return { ...job, artifacts: { ...job.artifacts, log } };
}

function withRemovedFiles(job: Job): Job & { filesRemovedAfterDays?: number } {
  const days = retentionDays(process.env);
  const hadFiles = Boolean(job.artifacts?.model || job.artifacts?.gcode);
  if (days === 0 || !hadFiles || job.updatedAt >= Date.now() - days * DAY_MS) return job;
  const folder = join(resolve(process.env.DATA_DIR ?? "/data"), job.id);
  return existsSync(folder) ? job : { ...job, filesRemovedAfterDays: days };
}
