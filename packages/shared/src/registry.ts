import type { GeneratorPlugin, SlicerPlugin, TransportPlugin } from "./plugins.js";
import type { Station } from "./station.js";
import type { JobRequest } from "./job.js";

/** Startup-populated map of available plugins per stage. */
export interface Registry {
  generators: Map<string, GeneratorPlugin>;
  slicers: Map<string, SlicerPlugin>;
  transports: Map<string, TransportPlugin>;
}

export function createRegistry(): Registry {
  return {
    generators: new Map(),
    slicers: new Map(),
    transports: new Map(),
  };
}

export class CompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompatibilityError";
  }
}

function intersects(a: string[], b: string[]): boolean {
  return a.some((x) => b.includes(x));
}

/**
 * Pre-flight validation, run in the API before enqueue. Throws CompatibilityError
 * if the resolved generator → slicer → transport chain cannot interoperate, so an
 * incompatible combo fails fast with a 4xx instead of dying mid-pipeline.
 */
export function validateJob(req: JobRequest, station: Station, reg: Registry): void {
  const generator = reg.generators.get(req.generator.id);
  if (!generator) throw new CompatibilityError(`unknown generator: ${req.generator.id}`);

  const slicer = reg.slicers.get(station.slicerId);
  if (!slicer) throw new CompatibilityError(`unknown slicer: ${station.slicerId}`);

  const transport = reg.transports.get(station.transportId);
  if (!transport) throw new CompatibilityError(`unknown transport: ${station.transportId}`);

  if (station.allowedGenerators && !station.allowedGenerators.includes(generator.id)) {
    throw new CompatibilityError(`station ${station.id} does not allow generator ${generator.id}`);
  }

  // generator.outputs ∩ slicer.accepts ≠ ∅
  if (!intersects(generator.outputs, slicer.accepts)) {
    throw new CompatibilityError(
      `generator ${generator.id} outputs [${generator.outputs}] but slicer ${slicer.id} accepts [${slicer.accepts}]`,
    );
  }

  if (!slicer.profiles.some((p) => p.id === station.profileId)) {
    throw new CompatibilityError(`slicer ${slicer.id} has no profile ${station.profileId}`);
  }

  // slicer.gcodeFlavor ∈ transport.acceptsFlavors
  if (!transport.acceptsFlavors.includes(slicer.gcodeFlavor)) {
    throw new CompatibilityError(
      `slicer ${slicer.id} emits ${slicer.gcodeFlavor} but transport ${transport.id} accepts [${transport.acceptsFlavors}]`,
    );
  }
}
