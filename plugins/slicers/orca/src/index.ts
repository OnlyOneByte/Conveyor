import { spawn } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type GcodeArtifact,
  type ModelArtifact,
  type ProfileRef,
  type SlicerPlugin,
  type StageCtx,
  StageError,
} from "@conveyor/shared";

const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const ORCA_BIN = process.env.ORCA_BIN ?? "orca-slicer";
const ORCA_DATADIR = process.env.ORCA_DATADIR ?? "/opt/orca/squashfs-root/resources/profiles";

const PROFILES: ProfileRef[] = [
  { id: "orca/klipper-pla-0.2", name: "Klipper PLA 0.2mm", path: "/profiles/orca-klipper-pla-0.2" },
];

export const orca: SlicerPlugin = {
  id: "orca",
  name: "OrcaSlicer",
  version: "0.1.0",
  stage: "slicer",
  accepts: ["stl", "3mf"],
  gcodeFlavor: "klipper",
  profiles: PROFILES,

  async slice(model: ModelArtifact, profile: ProfileRef, ctx: StageCtx): Promise<GcodeArtifact> {
    const out = join(ctx.workDir, "model.gcode");

    if (STUB) {
      ctx.log(`[stub] slice ${model.path} with ${profile.id}`);
      await writeFile(
        out,
        `; conveyor stub gcode\n; profile=${profile.id}\n; source=${model.path}\n`,
      );
      return { path: out, format: "gcode", meta: { profileId: profile.id, stub: true } };
    }

    const args = [
      "--datadir",
      ORCA_DATADIR,
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
    ctx.log(`xvfb-run -a ${ORCA_BIN} ${args.join(" ")}`);
    await run("xvfb-run", ["-a", ORCA_BIN, ...args], ctx);

    await copyFile(join(ctx.workDir, "plate_1.gcode"), out);
    return { path: out, format: "gcode", meta: { profileId: profile.id } };
  },
};

function run(cmd: string, args: string[], ctx: StageCtx): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: ctx.signal });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) => reject(new StageError("slicer", e.message, { cause: e })));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new StageError("slicer", `${cmd} exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}
