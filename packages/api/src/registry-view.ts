import { gridfinity } from "@conveyor/generator-gridfinity";
import { passthrough } from "@conveyor/generator-passthrough";
import { createRegistry, type SlicerPlugin, type TransportPlugin } from "@conveyor/shared";

export const apiRegistry = createRegistry();

apiRegistry.generators.set(gridfinity.id, gridfinity);
apiRegistry.generators.set(passthrough.id, passthrough);

apiRegistry.slicers.set("orca", {
  id: "orca",
  name: "OrcaSlicer",
  version: "0.0.0",
  stage: "slicer",
  accepts: ["stl", "3mf"],
  gcodeFlavor: "klipper",
  profiles: [
    {
      id: "orca/klipper-pla-0.2",
      name: "Klipper PLA 0.2mm",
      path: "/profiles/orca-klipper-pla-0.2",
    },
  ],
  slice: () => {
    throw new Error("api holds a capability-only view; slicing runs in the worker");
  },
} satisfies SlicerPlugin);

apiRegistry.slicers.set("prusa", {
  id: "prusa",
  name: "PrusaSlicer",
  version: "0.1.0",
  stage: "slicer",
  accepts: ["stl", "3mf", "obj"],
  gcodeFlavor: "klipper",
  profiles: [
    {
      id: "prusa/klipper-pla-0.2",
      name: "Klipper PLA 0.2mm (Prusa)",
      path: "/profiles/prusa-klipper-pla-0.2",
    },
    {
      id: "prusa/marlin-pla-0.2",
      name: "Marlin PLA 0.2mm (Prusa)",
      path: "/profiles/prusa-marlin-pla-0.2",
    },
  ],
  slice: () => {
    throw new Error("api holds a capability-only view; slicing runs in the worker");
  },
} satisfies SlicerPlugin);

const transportView = (id: string, name: string): TransportPlugin => ({
  id,
  name,
  version: "0.0.0",
  stage: "transport",
  acceptsFlavors: ["klipper", "marlin"],
  submit: () => {
    throw new Error("api holds a capability-only view; transport runs in the worker");
  },
  status: () => {
    throw new Error("api holds a capability-only view");
  },
});

apiRegistry.transports.set("moonraker", transportView("moonraker", "Klipper / Moonraker"));
apiRegistry.transports.set("elegoo", transportView("elegoo", "ElegooLink"));
