import { spawn } from "node:child_process";
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

const SCAD_FILE = process.env.GRIDFINITY_SCAD ?? "/scad/gridfinity-rebuilt-openscad/gridfinity.scad";

/** Map validated params → OpenSCAD -D assignments. */
function toScadDefines(p: GridfinityParams): string[] {
  const d: Record<string, number | boolean> = {
    gridx: p.gridX,
    gridy: p.gridY,
    gridz: p.heightUnits,
    divx: p.divisionsX,
    divy: p.divisionsY,
    enable_scoop: p.scoop,
    enable_label: p.labelTab,
    enable_magnet: p.magnetHoles,
    enable_lip: p.stackingLip,
  };
  return Object.entries(d).flatMap(([k, v]) => ["-D", `${k}=${typeof v === "boolean" ? v : v}`]);
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
    const args = ["-o", out, ...toScadDefines(parsed.data), SCAD_FILE];
    ctx.log(`openscad ${args.join(" ")}`);

    await run("openscad", args, ctx);
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
        : reject(new StageError("generator", `openscad exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}
