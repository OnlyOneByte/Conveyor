import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fakeTransport, stubSlicer } from "../test/helpers/index.ts";
import type { JobRequest, JobTarget } from "./job";
import type { GeneratorPlugin } from "./plugins";
import { CompatibilityError, createRegistry, validateJob } from "./registry";

const generator = (id: string, outputs: string[]): GeneratorPlugin => ({
  id,
  name: id,
  version: "0.0.0",
  stage: "generator",
  params: z.object({}),
  paramSchema: {},
  outputs,
  generate: async () => {
    throw new Error("validateJob never generates");
  },
});

const registry = () => {
  const reg = createRegistry();
  for (const plugin of [generator("box", ["stl"]), generator("drawing", ["svg"])])
    reg.generators.set(plugin.id, plugin);
  reg.slicers.set("orca", stubSlicer({ id: "orca" }).plugin);
  reg.transports.set(
    "moonraker",
    fakeTransport({ id: "moonraker", acceptsFlavors: ["klipper"] }).plugin,
  );
  return reg;
};

const request: JobRequest = {
  generator: { id: "box", params: {} },
  printerId: "p1",
  profileId: "prof",
};

const target: JobTarget = {
  printerId: "p1",
  transportId: "moonraker",
  profileId: "prof",
  profileName: "Prof",
  profilePath: "/profiles/prof",
  slicerId: "orca",
  gcodeFlavor: "klipper",
};

const refusal = (req: JobRequest, tgt: JobTarget) => {
  try {
    validateJob(req, tgt, registry());
  } catch (error) {
    if (error instanceof CompatibilityError) return error.message;
    throw error;
  }
  return null;
};

describe("validateJob", () => {
  test("accepts a job whose generator, slicer, transport and flavor all fit", () => {
    expect(refusal(request, target)).toBeNull();
  });

  test.each<[string, JobRequest, JobTarget, string]>([
    [
      "an unknown generator",
      { ...request, generator: { id: "nope", params: {} } },
      target,
      "unknown generator: nope",
    ],
    [
      "a generator the printer does not allow",
      request,
      { ...target, allowedGenerators: ["other", "else"] },
      "printer p1 does not allow generator box (allows: other, else)",
    ],
    [
      "any generator on a printer with an empty allowlist",
      request,
      { ...target, allowedGenerators: [] },
      "printer p1 does not allow generator box (its allowlist is empty)",
    ],
    ["an unknown slicer", request, { ...target, slicerId: "cura" }, "unknown slicer: cura"],
    [
      "an unknown transport",
      request,
      { ...target, transportId: "octoprint" },
      "unknown transport: octoprint",
    ],
    [
      "a slicer that cannot read the generator's output",
      { ...request, generator: { id: "drawing", params: {} } },
      target,
      "generator drawing outputs [svg] but slicer orca accepts [stl,3mf]",
    ],
    [
      "a flavor the transport does not accept",
      request,
      { ...target, gcodeFlavor: "marlin" },
      "profile prof emits marlin but transport moonraker accepts [klipper]",
    ],
  ])("refuses %s", (_label, req, tgt, message) => {
    expect(refusal(req, tgt)).toBe(message);
  });
});
