import { z } from "zod";

/**
 * The passthrough generator takes no shape parameters — the model IS the
 * uploaded file. Its only "param" is a reference to a previously-uploaded STL
 * (the API stores the bytes under /data/uploads and hands back an uploadId).
 *
 * uploadId is constrained to a safe slug so it can never escape the uploads
 * directory when joined into a filesystem path (no '/', '..', etc.).
 */
export const passthroughParams = z.object({
  uploadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, "uploadId must be a url-safe id")
    .max(128),
  /** original filename, shown in the UI / job record (not used for IO). */
  filename: z.string().max(255).optional(),
});

export type PassthroughParams = z.infer<typeof passthroughParams>;
