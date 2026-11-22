import { isBundledProfilePath } from "@conveyor/shared";
import { z } from "zod";
import { apiRegistry } from "./registry.js";

export const MAX_SECRETS = 16;
export const MAX_SECRET_KEY_LENGTH = 64;
export const MAX_SECRET_VALUE_LENGTH = 4096;

const knownFlavors = () =>
  new Set([...apiRegistry.transports.values()].flatMap((t) => t.acceptsFlavors));

const profileSchema = z.object({
  id: z.string().min(1).max(128),
  slicerId: z
    .string()
    .min(1)
    .refine((id) => apiRegistry.slicers.has(id), "unknown slicer"),
  name: z.string().min(1).max(200),
  path: z.string().max(500).refine(isBundledProfilePath, "path must be /profiles/<bundle>"),
  gcodeFlavor: z
    .string()
    .min(1)
    .refine((flavor) => knownFlavors().has(flavor), "unknown gcode flavor"),
});

const secretsSchema = z
  .record(z.string().min(1).max(MAX_SECRET_KEY_LENGTH), z.string().max(MAX_SECRET_VALUE_LENGTH))
  .refine(
    (secrets) => Object.keys(secrets).length <= MAX_SECRETS,
    `at most ${MAX_SECRETS} secrets`,
  );

const printerSchema = z.object({
  id: z.string().min(1).max(128),
  transportId: z
    .string()
    .min(1)
    .refine((id) => apiRegistry.transports.has(id), "unknown transport"),
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(255),
  secrets: secretsSchema.optional(),
  allowedGenerators: z
    .array(z.string().refine((id) => apiRegistry.generators.has(id), "unknown generator"))
    .optional(),
});

export function parseProfile(body: unknown) {
  return profileSchema.safeParse(body);
}

export function parsePrinter(body: unknown) {
  return printerSchema.safeParse(body);
}
