import { resolve, sep } from "node:path";

export const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inside(root: string, name: string): string | undefined {
  const base = resolve(root);
  const path = resolve(base, name);
  return path.startsWith(base + sep) && !path.slice(base.length + 1).includes(sep)
    ? path
    : undefined;
}

export const jobFolder = (dataDir: string, jobId: string): string | undefined =>
  JOB_ID.test(jobId) ? inside(dataDir, jobId) : undefined;

export const refusedJobId = (jobId: string): string =>
  `job id ${JSON.stringify(jobId)} isn't a UUID, so Conveyor won't make a folder for it`;
