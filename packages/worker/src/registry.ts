import { createRegistry, type Registry } from "@conveyor/shared";
import { gridfinity } from "@conveyor/generator-gridfinity";
import { orca } from "@conveyor/slicer-orca";
import { moonraker } from "@conveyor/transport-moonraker";
import { elegoo } from "@conveyor/transport-elegoo";

/**
 * The worker is the only process that loads real adapters. Plugins self-register
 * here at startup (ADR 0001: in-process adapters, isolated engines).
 */
export function buildRegistry(): Registry {
  const reg = createRegistry();
  reg.generators.set(gridfinity.id, gridfinity);
  reg.slicers.set(orca.id, orca);
  reg.transports.set(moonraker.id, moonraker);
  reg.transports.set(elegoo.id, elegoo);
  return reg;
}
