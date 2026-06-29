import {
  createRegistry,
  type GeneratorPlugin,
  type SlicerPlugin,
  type TransportPlugin,
} from "@conveyor/shared";

/**
 * M0: a capability-only view of the registry for pre-flight validation. The API
 * does not load real adapters (no engines in the api image); it only needs the
 * declared capabilities to run validateJob(). M-later: have the worker publish
 * its registered manifests to Redis on boot and hydrate this from there.
 */
export const apiRegistry = createRegistry();

apiRegistry.generators.set("gridfinity", {
  id: "gridfinity",
  name: "Gridfinity Bin",
  version: "0.0.0",
  stage: "generator",
  paramSchema: {},
  outputs: ["stl", "3mf"],
  generate: () => {
    throw new Error("api holds a capability-only view; generation runs in the worker");
  },
} satisfies GeneratorPlugin);

apiRegistry.slicers.set("orca", {
  id: "orca",
  name: "OrcaSlicer",
  version: "0.0.0",
  stage: "slicer",
  accepts: ["stl", "3mf"],
  gcodeFlavor: "klipper",
  profiles: [
    { id: "orca/klipper-pla-0.2", name: "Klipper PLA 0.2mm", path: "/profiles/klipper-pla-0.2" },
    { id: "orca/elegoo-pla-0.2", name: "Elegoo PLA 0.2mm", path: "/profiles/elegoo-pla-0.2" },
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
  // eslint-disable-next-line require-yield
  async *status() {
    throw new Error("api holds a capability-only view");
  },
});

apiRegistry.transports.set("moonraker", transportView("moonraker", "Klipper / Moonraker"));
apiRegistry.transports.set("elegoo", transportView("elegoo", "ElegooLink"));
