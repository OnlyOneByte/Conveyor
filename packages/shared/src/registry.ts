import type { JobRequest, JobTarget } from "./job.js";
import type { GeneratorPlugin, SlicerPlugin, TransportPlugin } from "./plugins.js";

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

export function validateJob(req: JobRequest, target: JobTarget, reg: Registry): void {
  const generator = reg.generators.get(req.generator.id);
  if (!generator) throw new CompatibilityError(`unknown generator: ${req.generator.id}`);

  if (target.allowedGenerators && !target.allowedGenerators.includes(generator.id)) {
    throw new CompatibilityError(
      `printer ${target.printerId} does not allow generator ${generator.id}` +
        (target.allowedGenerators.length
          ? ` (allows: ${target.allowedGenerators.join(", ")})`
          : " (its allowlist is empty)"),
    );
  }

  const slicer = reg.slicers.get(target.slicerId);
  if (!slicer) throw new CompatibilityError(`unknown slicer: ${target.slicerId}`);

  const transport = reg.transports.get(target.transportId);
  if (!transport) throw new CompatibilityError(`unknown transport: ${target.transportId}`);

  if (!intersects(generator.outputs, slicer.accepts)) {
    throw new CompatibilityError(
      `generator ${generator.id} outputs [${generator.outputs}] but slicer ${slicer.id} accepts [${slicer.accepts}]`,
    );
  }

  if (!transport.acceptsFlavors.includes(target.gcodeFlavor)) {
    throw new CompatibilityError(
      `profile ${target.profileId} emits ${target.gcodeFlavor} but transport ${transport.id} accepts [${transport.acceptsFlavors}]`,
    );
  }
}
