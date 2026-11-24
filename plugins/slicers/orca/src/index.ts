import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  GcodeArtifact,
  ModelArtifact,
  ProfileRef,
  SlicerPlugin,
  StageCtx,
} from "@conveyor/shared";
import { requireOutput, runEngine } from "@conveyor/shared/node";

const stub = () => process.env.CONVEYOR_ENGINE_STUB === "1";
const orcaBin = () => process.env.ORCA_BIN ?? "orca-slicer";
const orcaDatadir = () => process.env.ORCA_DATADIR ?? "/opt/orca/squashfs-root/resources/profiles";

export const orca: SlicerPlugin = {
  id: "orca",
  name: "OrcaSlicer",
  version: "0.1.0",
  stage: "slicer",
  accepts: ["stl", "3mf"],
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

    const args = [
      "--datadir",
      orcaDatadir(),
      "--load-settings",
      `${join(profile.path, "machine.json")};${join(profile.path, "process.json")}`,
      "--load-filaments",
      join(profile.path, "filament.json"),
      "--slice",
      "0",
      "--outputdir",
      ctx.workDir,
      model.path,
    ];
    const bin = orcaBin();
    ctx.log(`xvfb-run -a ${bin} ${args.join(" ")}`);
    const { stderr } = await runEngine("slicer", "xvfb-run", ["-a", bin, ...args], ctx);
    const plate = join(ctx.workDir, "plate_1.gcode");
    await requireOutput("slicer", plate, `${bin} exited 0 but wrote no G-code`, stderr);

    await copyFile(plate, out);
    return { path: out, format: "gcode", meta: { profileId: profile.id } };
  },
};
