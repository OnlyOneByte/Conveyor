import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  StageError,
  type GeneratorPlugin,
  type JSONSchema7,
  type ModelArtifact,
  type StageCtx,
} from "@conveyor/shared";
import { gridfinityParams, type GridfinityParams } from "./params.js";

// Entry file + variable names verified against gridfinity-rebuilt-openscad @ HEAD
// (2025-08) by rendering a real STL with OpenSCAD 2023.09 nightly: a 2×3 bin
// measured 83.5×125.5mm, exactly the Gridfinity spec. See docs/M1-WORKER-ENGINES.md.
const SCAD_FILE =
  process.env.GRIDFINITY_SCAD ?? "/scad/gridfinity-rebuilt-openscad/gridfinity-rebuilt-bins.scad";

/** M0 engine-stub: emit a placeholder STL so the pipeline runs without OpenSCAD installed. */
const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";

/**
 * Map our friendly params → the lib's actual OpenSCAD variables (verified names):
 *   gridx/gridy/gridz, divx/divy            — direct
 *   scoop          ∈ [0..1] float           — our bool → 1 (full ramp) or 0
 *   style_tab      0=Full…5=None            — our labelTab bool → 1 (Auto) or 5 (None)
 *   magnet_holes   bool                     — was wrongly "enable_magnet"
 *   include_lip    bool                     — was wrongly "enable_lip"
 *
 * Verified-by-render gotcha: the lib asserts magnet_holes is incompatible with
 * refined_holes (default true), so we must force refined_holes=false whenever
 * magnets are on, or OpenSCAD aborts with an empty object.
 */
function toScadDefines(p: GridfinityParams): string[] {
  const d: Record<string, number | boolean> = {
    gridx: p.gridX,
    gridy: p.gridY,
    gridz: p.heightUnits,
    divx: p.divisionsX,
    divy: p.divisionsY,
    scoop: p.scoop ? 1 : 0,
    style_tab: p.labelTab ? 1 : 5,
    magnet_holes: p.magnetHoles,
    refined_holes: p.magnetHoles ? false : true, // mutually exclusive (lib assertion)
    include_lip: p.stackingLip,
  };
  return Object.entries(d).flatMap(([k, v]) => ["-D", `${k}=${v}`]);
}

export const gridfinity: GeneratorPlugin<GridfinityParams> = {
  id: "gridfinity",
  name: "Gridfinity Bin",
  version: "0.1.0",
  stage: "generator",
  outputs: ["stl"],
  paramSchema: zodToJsonSchema(gridfinityParams, "GridfinityParams") as JSONSchema7,
  preview: { kind: "procedural", module: "gridfinity" }, // client builds geometry from params

  async generate(rawParams, ctx: StageCtx): Promise<ModelArtifact> {
    const parsed = gridfinityParams.safeParse(rawParams);
    if (!parsed.success) throw new StageError("generator", `invalid params: ${parsed.error.message}`);

    const out = join(ctx.workDir, "model.stl");

    if (STUB) {
      ctx.log(`[stub] generate gridfinity ${parsed.data.gridX}x${parsed.data.gridY}`);
      await writeFile(out, `solid conveyor-stub\nendsolid conveyor-stub\n`);
      return { path: out, format: "stl", meta: { params: parsed.data, stub: true } };
    }

    const args = ["-o", out, ...toScadDefines(parsed.data), SCAD_FILE];
    // The worker image installs an OpenSCAD nightly at OPENSCAD_BIN (the lib needs
    // 2023+); fall back to a PATH `openscad` for local/dev use.
    const bin = process.env.OPENSCAD_BIN ?? "openscad";
    ctx.log(`${bin} ${args.join(" ")}`);

    await run(bin, args, ctx);
    return { path: out, format: "stl", meta: { params: parsed.data } };
  },
};

/** Spawn an engine subprocess; the worker supervises timeout/cancel via ctx.signal. */
function run(cmd: string, args: string[], ctx: StageCtx): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: ctx.signal });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) => reject(new StageError("generator", e.message, { cause: e })));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new StageError("generator", `${cmd} exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}
