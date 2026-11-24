import { z } from "zod";
import type { JobStatusEvent } from "./events.js";
import { jobRequestSchema } from "./job.js";

export const jobFieldsSchema = z.object({
  printerId: z.string().min(1),
  profileId: z.string().min(1),
  generator: jobRequestSchema.shape.generator,
  createdAt: z.number().int().nonnegative(),
});

export type JobFields = z.infer<typeof jobFieldsSchema>;

export type JobView = JobStatusEvent & Partial<JobFields>;

export interface JobViewResult {
  view: JobView;
  complete: boolean;
}

export function jobView(snapshot: JobStatusEvent, fields: unknown): JobViewResult {
  const parsed = jobFieldsSchema.safeParse(fields);
  return parsed.success
    ? { view: { ...snapshot, ...parsed.data }, complete: true }
    : { view: snapshot, complete: false };
}
