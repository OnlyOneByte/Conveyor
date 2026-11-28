import type { Database } from "bun:sqlite";
import { printerFileName } from "@conveyor/shared";
import { dbListJobs } from "@conveyor/shared/db";
import { z } from "zod";
import { messageOf, type Run } from "./run.js";

export const DEFAULT_KEEP_FILES = 5;
const PRUNE_TIMEOUT_MS = 60000;

const KeepFiles = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().max(Number.MAX_SAFE_INTEGER));

export function printerKeepFiles(env: Record<string, string | undefined>): number {
  const raw = env.CONVEYOR_PRINTER_KEEP_FILES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_KEEP_FILES;
  const parsed = KeepFiles.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(`CONVEYOR_PRINTER_KEEP_FILES must be a whole number, 0 or more, got ${raw}`);
}

export function filesToKeep(
  db: Database,
  keep: number,
  printerId: string,
  jobId: string,
): string[] {
  if (keep <= 0) return [];
  const earlier = dbListJobs(db, { limit: keep, printerId, reachedPrinter: true })
    .map(({ id }) => id)
    .filter((id) => id !== jobId)
    .slice(0, keep - 1);
  return [jobId, ...earlier].map(printerFileName);
}

export async function prunePrinter(run: Run): Promise<void> {
  const attempt = run.print;
  const keep = run.deps.printerFilesToKeep;
  if (!attempt?.transport.pruneFiles || !keep) return;
  if (attempt.mayHaveStarted || attempt.notStarted || run.signal.aborted) return;
  const { jobId } = run.opts;
  try {
    await run.ctx.confirmStart?.();
  } catch {
    run.ctx.log(
      `job ${jobId}: the printer lock was lost, so old files on the printer were left alone`,
    );
    return;
  }
  try {
    const names = new Set(keep(attempt.printer.id, jobId));
    const signal = AbortSignal.timeout(PRUNE_TIMEOUT_MS);
    const removed = await attempt.transport.pruneFiles(attempt.printer, names, signal);
    if (removed.length > 0)
      run.ctx.log(`job ${jobId}: removed old files from the printer: ${removed.join(", ")}`);
  } catch (err) {
    run.ctx.log(`job ${jobId}: printer file cleanup did not finish: ${messageOf(err)}`);
  }
}
