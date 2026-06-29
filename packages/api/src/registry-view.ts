import {
  createRegistry,
  type SlicerPlugin,
  type TransportPlugin,
} from "@conveyor/shared";
import { gridfinity } from "@conveyor/generator-gridfinity";

/**
 * Capability + metadata view of the registry. The API runs validateJob() and
 * serves generator metadata (paramSchema/preview) to the PWA, but never calls a
 * plugin's generate()/slice()/submit() — those run only in the worker (ADR 0001).
 * Generator plugins are imported for their schema/preview/outputs (pure data);
 * slicer/transport capabilities are declared inline (their real adapters live in
 * the worker image with the engines). M-later: hydrate from worker-published
 * manifests over Redis on boot.
 */
export const apiRegistry = createRegistry();

// Real generator metadata (paramSchema drives the PWA form). generate() is wired
// but never invoked in the api process.
apiRegistry.generators.set(gridfinity.id, gridfinity);

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
