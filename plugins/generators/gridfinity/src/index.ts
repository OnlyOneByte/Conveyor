import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type GeneratorPlugin,
  type JSONSchema7,
  type ModelArtifact,
  type StageCtx,
  StageError,
} from "@conveyor/shared";
import { runEngine } from "@conveyor/shared/node";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type GridfinityParams, gridfinityParams } from "./params.js";

const scadFile = () =>
  process.env.GRIDFINITY_SCAD ?? "/scad/gridfinity-rebuilt-openscad/gridfinity-rebuilt-bins.scad";
const stub = () => process.env.CONVEYOR_ENGINE_STUB === "1";

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
    refined_holes: false,
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
  params: gridfinityParams,
  paramSchema: zodToJsonSchema(gridfinityParams, "GridfinityParams") as JSONSchema7,
  ui: {
    groups: [
      { title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" },
      { title: "Height", fields: ["heightUnits"], layout: "stack" },
    ],
    advanced: {
      title: "More options",
      groups: [
        { title: "Compartments", fields: ["divisionsX", "divisionsY"], layout: "pair" },
        { fields: ["scoop", "labelTab", "magnetHoles", "stackingLip"], layout: "grid" },
      ],
    },
    controls: {
      gridX: "stepper",
      gridY: "stepper",
      heightUnits: "stepper",
      divisionsX: "stepper",
      divisionsY: "stepper",
    },
    unitMm: { gridX: 42, gridY: 42, heightUnits: 7 },
    note: "1u = 42 mm footprint · 7 mm height",
  },
  preview: { kind: "procedural", module: "gridfinity" },

  async generate(rawParams, ctx: StageCtx): Promise<ModelArtifact> {
    const parsed = gridfinityParams.safeParse(rawParams);
    if (!parsed.success)
      throw new StageError("generator", `invalid params: ${parsed.error.message}`);

    const out = join(ctx.workDir, "model.stl");

    if (stub()) {
      ctx.log(`[stub] generate gridfinity ${parsed.data.gridX}x${parsed.data.gridY}`);
      await writeFile(out, `solid conveyor-stub\nendsolid conveyor-stub\n`);
      return { path: out, format: "stl", meta: { params: parsed.data, stub: true } };
    }

    const args = ["-o", out, ...toScadDefines(parsed.data), scadFile()];
    const bin = process.env.OPENSCAD_BIN ?? "openscad";
    ctx.log(`${bin} ${args.join(" ")}`);

    await runEngine("generator", bin, args, ctx);
    return { path: out, format: "stl", meta: { params: parsed.data } };
  },
};
