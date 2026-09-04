import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { openDb, dbGetJob } from "@conveyor/shared/db";

/**
 * The worker writes each job's artifacts under `${DATA_DIR}/<jobId>/` (see
 * packages/worker/src/index.ts). The API resolves the SAME root so a download can be
 * containment-checked against it. Both default to `/data` in the container and can be
 * overridden together in local/dev via DATA_DIR.
 */
const DATA_DIR = resolve(process.env.DATA_DIR ?? "/data");

export type ArtifactKind = "model" | "gcode";

/** Suggested filename + content type per artifact kind. */
const KIND_META: Record<ArtifactKind, { filename: string; contentType: string }> = {
  model: { filename: "model.stl", contentType: "model/stl" },
  gcode: { filename: "model.gcode", contentType: "text/x.gcode" },
};

export class ArtifactError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 410 = 404,
  ) {
    super(message);
  }
}

export interface ResolvedArtifact {
  /** canonical, containment-checked absolute path safe to stream */
  path: string;
  filename: string;
  contentType: string;
  size: number;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolve a job's artifact to a safe, streamable path. The path comes from the job's
 * OWN durable record (never from the request), must sit under `${DATA_DIR}/<jobId>/`
 * after realpath (so a symlink cannot escape), and must still exist on disk. A failed
 * run that never produced the file, or a reaped work dir, yields a 404/410 — the
 * request-supplied surface is only the opaque jobId and the fixed kind enum.
 */
export async function resolveJobArtifact(jobId: string, kind: ArtifactKind): Promise<ResolvedArtifact> {
  const job = dbGetJob(openDb(), jobId);
  if (!job) throw new ArtifactError(`no settled job with id ${jobId}`);

  const stored = job.artifacts?.[kind];
  if (!stored) throw new ArtifactError(`job ${jobId} has no ${kind} artifact recorded`);

  const jobRoot = join(DATA_DIR, jobId);
  let canonical: string;
  try {
    canonical = await realpath(resolve(stored));
  } catch {
    // Recorded, but the file is gone (work dir reaped / volume changed).
    throw new ArtifactError(`the ${kind} artifact for job ${jobId} is no longer on disk`, 410);
  }

  // Containment: the canonical file must live under this job's own work dir. Realpath
  // the root too so a symlinked DATA_DIR compares correctly.
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(jobRoot);
  } catch {
    throw new ArtifactError(`the work directory for job ${jobId} is no longer on disk`, 410);
  }
  if (!isWithin(canonicalRoot, canonical)) {
    throw new ArtifactError(`the ${kind} artifact path escapes the job work directory`);
  }

  const info = await stat(canonical);
  if (!info.isFile()) throw new ArtifactError(`the ${kind} artifact for job ${jobId} is not a file`, 410);

  const meta = KIND_META[kind];
  return { path: canonical, filename: meta.filename, contentType: meta.contentType, size: info.size };
}

/** Open a read stream for a resolved artifact (separated so routes stay thin). */
export function openArtifactStream(path: string): ReturnType<typeof createReadStream> {
  return createReadStream(path);
}
