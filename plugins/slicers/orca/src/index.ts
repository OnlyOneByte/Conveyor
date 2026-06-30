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
// Orca leaf presets use `inherits` chains that only resolve when the full vendor
// profile tree is visible via --datadir. The worker mounts it here (the AppImage's
// own resources/profiles, or an override). Verified required 2026-06-30.
const ORCA_DATADIR = process.env.ORCA_DATADIR ?? "/opt/orca/squashfs-root/resources/profiles";

// Locked, server-side profiles. Bundles live under /profiles (mounted read-only).
// Each is a directory of OrcaSlicer leaf exports (machine.json / process.json /
// filament.json) whose `inherits` chains resolve against ORCA_DATADIR. The
// klipper bundle (Creality K1 family) is VERIFIED 2026-06-30 — sliced a cube to
// real klipper gcode (302 layers) in the worker image. See docs/M1-WORKER-ENGINES.md.
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
    // CLI verified 2026-06-30 against OrcaSlicer 2.4.1 (aarch64 AppImage) slicing
    // a cube → real gcode in the worker base image (see docs/M1-WORKER-ENGINES.md):
    //   • action verb is `--slice 0` (0 = all plates); there is NO --export-gcode
    //   • machine+process join in ONE --load-settings "a.json;b.json" (`;`-sep)
    //   • filament(s) via --load-filaments "f.json"
    //   • --outputdir is a DIRECTORY; Orca writes `plate_1.gcode` (+ result.json),
    //     NOT a file named after the model
    //   • leaf presets `inherit` → --datadir must point at the vendor profile tree
    const args = [
      "--datadir", ORCA_DATADIR,
      "--load-settings", `${join(profile.path, "machine.json")};${join(profile.path, "process.json")}`,
      "--load-filaments", join(profile.path, "filament.json"),
      "--slice", "0",
      "--outputdir", ctx.workDir,
      model.path,
    ];
    ctx.log(`xvfb-run -a ${ORCA_BIN} ${args.join(" ")}`);
    await run("xvfb-run", ["-a", ORCA_BIN, ...args], ctx);

    // Orca writes per-plate files (plate_1.gcode for a single-plate slice).
    // Normalize to model.gcode so the transport stage has a stable path.
    await copyFile(join(ctx.workDir, "plate_1.gcode"), out);
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
