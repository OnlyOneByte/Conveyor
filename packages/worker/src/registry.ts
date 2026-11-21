import { gridfinity } from "@conveyor/generator-gridfinity";
import { passthrough } from "@conveyor/generator-passthrough";
import { createRegistry, type Registry } from "@conveyor/shared";
import { orca } from "@conveyor/slicer-orca";
import { prusa } from "@conveyor/slicer-prusa";
import { elegoo } from "@conveyor/transport-elegoo";
import { moonraker } from "@conveyor/transport-moonraker";

export function buildRegistry(): Registry {
  const reg = createRegistry();
  reg.generators.set(gridfinity.id, gridfinity);
  reg.generators.set(passthrough.id, passthrough);
  reg.slicers.set(orca.id, orca);
  reg.slicers.set(prusa.id, prusa);
  reg.transports.set(moonraker.id, moonraker);
  reg.transports.set(elegoo.id, elegoo);
  return reg;
}
