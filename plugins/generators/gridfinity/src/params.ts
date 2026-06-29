import { z } from "zod";

/**
 * Gridfinity bin parameters. This Zod schema is the single source of truth:
 * the worker validates against it, and the PWA renders the config form from its
 * JSON-Schema projection — zero per-generator UI code.
 */
export const gridfinityParams = z.object({
  gridX: z.number().int().min(1).max(20).default(2).describe("Width in 42mm units"),
  gridY: z.number().int().min(1).max(20).default(3).describe("Depth in 42mm units"),
  heightUnits: z.number().int().min(2).max(30).default(6).describe("Height in 7mm units"),
  divisionsX: z.number().int().min(1).max(10).default(1).describe("Compartments across"),
  divisionsY: z.number().int().min(1).max(10).default(1).describe("Compartments deep"),
  scoop: z.boolean().default(false).describe("Front scoop ramp"),
  labelTab: z.boolean().default(false).describe("Label tab"),
  magnetHoles: z.boolean().default(true).describe("Magnet holes in base"),
  stackingLip: z.boolean().default(true).describe("Stacking lip"),
});

export type GridfinityParams = z.infer<typeof gridfinityParams>;
