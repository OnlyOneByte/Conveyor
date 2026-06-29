import { spawn } from "node:child_process";
import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  StageError,
  type GcodeArtifact,
  type ModelArtifact,
  type ProfileRef,
  type SlicerPlugin,
  type StageCtx,
} from "@conveyor/shared";

/** M0 engine-stub: emit a placeholder gcode so the pipeline runs without Orca installed. */
const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const ORCA_BIN = process.env.ORCA_BIN ?? "orca-slicer";

// Locked, server-side profiles. Bundles live under /profiles (mounted read-only).
const PROFILES: ProfileRef[] = [
  { id: "orca/klipper-pla-0.2", name: "Klipper PLA 0.2mm", path: "/profiles/klipper-pla-0.2" },
  { id: "orca/elegoo-pla-0.2", name: "Elegoo PLA 0.2mm", path: "/profiles/elegoo-pla-0.2" },
];

export const orca: SlicerPlugin = {
  id: "orca",
  name: "OrcaSlicer",
  version: "0.1.0",
  stage: "slicer",
  accepts: ["stl", "3mf"],
  gcodeFlavor: "klipper",
  profiles: PROFILES,

  async slice(model: ModelArtifact, profileId: string, ctx: StageCtx): Promise<GcodeArtifact> {
    const profile = PROFILES.find((p) => p.id === profileId);
    if (!profile) throw new StageError("slicer", `unknown profile ${profileId}`);

    const out = join(ctx.workDir, "model.gcode");

    if (STUB) {
      ctx.log(`[stub] slice ${model.path} with ${profile.id}`);
      await writeFile(out, `; conveyor stub gcode\n; profile=${profile.id}\n; source=${model.path}\n`);
      return { path: out, format: "gcode", meta: { profileId, stub: true } };
    }

    // Orca is GUI-first; headless slicing needs a virtual framebuffer (xvfb).
    // Each locked profile bundle supplies printer/filament/process settings.
    //
    // ⚠️ M1 SPIKE — verify against `orca --help` inside the image. Orca's CLI has
    //   historically wanted machine+process joined in ONE --load-settings arg
    //   ("machine.json;process.json"), with filaments via --load-filaments. The
    //   repeated-flag form below is the first thing to confirm/correct.
    const args = [
      "--slice", "0",
      "--load-settings", `${join(profile.path, "machine.json")};${join(profile.path, "process.json")}`,
      "--load-filaments", join(profile.path, "filament.json"),
      "--outputdir", ctx.workDir,
      model.path,
    ];
    ctx.log(`xvfb-run -a ${ORCA_BIN} ${args.join(" ")}`);
    await run("xvfb-run", ["-a", ORCA_BIN, ...args], ctx);

    // Orca names output by model; normalize to model.gcode for the transport stage.
    await copyFile(join(ctx.workDir, "model.gcode"), out).catch(() => {});
    return { path: out, format: "gcode", meta: { profileId } };
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
