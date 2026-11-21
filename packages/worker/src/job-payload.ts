import { type JobRequest, jobRequestSchema, StageError } from "@conveyor/shared";
import type { PipelineDeps } from "./run.js";

export async function readJobPayload(
  jobId: string,
  data: unknown,
  publish: PipelineDeps["publish"],
): Promise<JobRequest> {
  const parsed = jobRequestSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  const error = {
    stage: "generator",
    reason: `invalid job payload: ${parsed.error.message}`,
  } as const;
  await publish(jobId, "failed", { stage: error.stage, error });
  throw new StageError(error.stage, error.reason);
}
