import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GcodeArtifact, ModelArtifact } from "../../src/artifacts.ts";
import { StageError } from "../../src/context.ts";
import type { ProfileRef, SlicerPlugin } from "../../src/plugins.ts";

export interface SliceCall {
  model: ModelArtifact;
  profile: ProfileRef;
  output: GcodeArtifact;
}

export interface StubSlicerOptions {
  id?: string;
  gcodeFlavor?: string;
  gcode?: string;
  failWith?: string;
}

export interface StubSlicer {
  plugin: SlicerPlugin;
  calls: SliceCall[];
}

export const STUB_GCODE = "G28\nG1 X10 Y10 F3000\nM84\n";

export function stubSlicer(options: StubSlicerOptions = {}): StubSlicer {
  const id = options.id ?? "stub";
  const gcodeFlavor = options.gcodeFlavor ?? "klipper";
  const calls: SliceCall[] = [];
  const plugin: SlicerPlugin = {
    id,
    name: "Stub slicer",
    version: "0.0.0",
    stage: "slicer",
    accepts: ["stl", "3mf"],
    gcodeFlavor,
    profiles: [{ id: `${id}/default`, name: "Stub default", path: "/profiles/stub" }],
    slice: async (model, profile, ctx) => {
      if (options.failWith !== undefined) throw new StageError("slicer", options.failWith);
      const path = join(ctx.workDir, "out.gcode");
      await writeFile(path, options.gcode ?? STUB_GCODE);
      const output: GcodeArtifact = { path, format: "gcode", meta: { flavor: gcodeFlavor } };
      calls.push({ model, profile, output });
      ctx.report(1, "sliced");
      return output;
    },
  };
  return { plugin, calls };
}
