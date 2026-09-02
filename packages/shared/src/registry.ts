import type { GeneratorPlugin, SlicerPlugin, TransportPlugin } from "./plugins.js";
import type { JobRequest, JobTarget } from "./job.js";

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
 *
 * Takes the resolved (printer, profile) target rather than a Station. The checks are
 * unchanged except that the transport's flavour check now uses the PROFILE's
 * gcodeFlavor instead of the slicer's. A slicer declares one flavour but can offer
 * profiles emitting others — `prusa` declares `klipper` yet ships
 * `prusa/marlin-pla-0.2` — so the slicer-level value was wrong for those profiles,
 * and disagreed with the check the old validateStation() did on the same pairing.
 */
export function validateJob(req: JobRequest, target: JobTarget, reg: Registry): void {
  const generator = reg.generators.get(req.generator.id);
  if (!generator) throw new CompatibilityError(`unknown generator: ${req.generator.id}`);

  // Per-printer allowlist. Checked before the capability maths because it is a policy
  // refusal, not an incompatibility — the pair might slice fine and still be
  // disallowed. Note `undefined` means unrestricted while `[]` allows nothing, so the
  // test is on presence, not truthiness of the contents.
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

  // generator.outputs ∩ slicer.accepts ≠ ∅
  if (!intersects(generator.outputs, slicer.accepts)) {
    throw new CompatibilityError(
      `generator ${generator.id} outputs [${generator.outputs}] but slicer ${slicer.id} accepts [${slicer.accepts}]`,
    );
  }

  if (!slicer.profiles.some((p) => p.id === target.profileId)) {
    throw new CompatibilityError(`slicer ${slicer.id} has no profile ${target.profileId}`);
  }

  // the profile's g-code flavour ∈ transport.acceptsFlavors
  if (!transport.acceptsFlavors.includes(target.gcodeFlavor)) {
    throw new CompatibilityError(
      `profile ${target.profileId} emits ${target.gcodeFlavor} but transport ${transport.id} accepts [${transport.acceptsFlavors}]`,
    );
  }
}
