import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dbGetJob, openDb } from "@conveyor/shared/db";
import { isWithin } from "@conveyor/shared/node";

export type ArtifactKind = "model" | "gcode";

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

interface ResolvedArtifact {
  path: string;
  filename: string;
  contentType: string;
  size: number;
}

export async function resolveJobArtifact(
  jobId: string,
  kind: ArtifactKind,
): Promise<ResolvedArtifact> {
  const job = dbGetJob(openDb(), jobId);
  if (!job) throw new ArtifactError(`no settled job with id ${jobId}`);

  const stored = job.artifacts?.[kind];
  if (!stored) throw new ArtifactError(`job ${jobId} has no ${kind} artifact recorded`);

  const jobRoot = join(resolve(process.env.DATA_DIR ?? "/data"), jobId);
  let canonical: string;
  try {
    canonical = await realpath(resolve(stored));
  } catch {
    throw new ArtifactError(`the ${kind} artifact for job ${jobId} is no longer on disk`, 410);
  }

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
  if (!info.isFile())
    throw new ArtifactError(`the ${kind} artifact for job ${jobId} is not a file`, 410);

  const meta = KIND_META[kind];
  return {
    path: canonical,
    filename: meta.filename,
    contentType: meta.contentType,
    size: info.size,
  };
}

export function openArtifactStream(path: string): ReturnType<typeof createReadStream> {
  return createReadStream(path);
}
