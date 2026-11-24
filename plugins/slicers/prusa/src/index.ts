import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type GcodeArtifact,
  type ModelArtifact,
  type ProfileRef,
  type SlicerPlugin,
  type StageCtx,
  StageError,
} from "@conveyor/shared";
import { requireOutput, runEngine } from "@conveyor/shared/node";

const stub = () => process.env.CONVEYOR_ENGINE_STUB === "1";
const prusaBin = () => process.env.PRUSA_BIN ?? "prusa-slicer";

export const prusa: SlicerPlugin = {
  id: "prusa",
  name: "PrusaSlicer",
  version: "0.1.0",
  stage: "slicer",
  accepts: ["stl", "3mf", "obj"],
  gcodeFlavor: "klipper",

  async slice(model: ModelArtifact, profile: ProfileRef, ctx: StageCtx): Promise<GcodeArtifact> {
    const out = join(ctx.workDir, "model.gcode");

    if (stub()) {
      ctx.log(`[stub] slice ${model.path} with ${profile.id}`);
      await writeFile(
        out,
        `; conveyor stub gcode\n; profile=${profile.id}\n; source=${model.path}\n`,
      );
      return { path: out, format: "gcode", meta: { profileId: profile.id, stub: true } };
    }

    const configs = await loadConfigs(profile.path);
    const args: string[] = [];
    for (const cfg of configs) args.push("--load", cfg);
    args.push("--export-gcode", "--output", out, model.path);

    const bin = prusaBin();
    ctx.log(`${bin} ${args.join(" ")}`);
    const { stderr } = await runEngine("slicer", bin, args, ctx);
    await requireOutput("slicer", out, `${bin} exited 0 but wrote no G-code`, stderr);

    return { path: out, format: "gcode", meta: { profileId: profile.id } };
  },
};

async function loadConfigs(profilePath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(profilePath);
  } catch (e) {
    throw new StageError(
      "slicer",
      `profile bundle not found at ${profilePath}: ${(e as Error).message}`,
    );
  }
  const inis = entries.filter((f) => f.toLowerCase().endsWith(".ini")).sort();
  if (inis.includes("config.ini")) return [join(profilePath, "config.ini")];
  if (inis.length === 0) {
    throw new StageError("slicer", `no .ini config found in profile bundle ${profilePath}`);
  }
  return inis.map((f) => join(profilePath, f));
}
