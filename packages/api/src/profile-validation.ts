import { isBundledProfilePath } from "@conveyor/shared";
import { z } from "zod";
import { apiRegistry } from "./registry-view.js";

const profileSchema = z.object({
  id: z.string().min(1).max(128),
  slicerId: z
    .string()
    .min(1)
    .refine((id) => apiRegistry.slicers.has(id), "unknown slicer"),
  name: z.string().min(1).max(200),
  path: z.string().max(500).refine(isBundledProfilePath, "path must be /profiles/<bundle>"),
  gcodeFlavor: z.string().min(1),
});

export function parseProfile(body: unknown) {
  return profileSchema.safeParse(body);
}
