import { z } from "zod";

export const passthroughParams = z
  .object({
    uploadId: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/, "uploadId must be a url-safe id")
      .max(128),
    filename: z.string().max(255).optional(),
  })
  .strict();

export type PassthroughParams = z.infer<typeof passthroughParams>;
