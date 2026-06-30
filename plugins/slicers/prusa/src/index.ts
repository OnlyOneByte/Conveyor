import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  StageError,
  type GcodeArtifact,
  type ModelArtifact,
  type ProfileRef,
  type SlicerPlugin,
  type StageCtx,
} from "@conveyor/shared";

/** M0 engine-stub: emit placeholder gcode so the pipeline runs without PrusaSlicer installed. */
const STUB = process.env.CONVEYOR_ENGINE_STUB === "1";
const PRUSA_BIN = process.env.PRUSA_BIN ?? "prusa-slicer";

// Locked, server-side profiles. Bundles live under /profiles (mounted read-only).
// A PrusaSlicer profile bundle is a directory of `.ini` config file(s) exported
// from the PrusaSlicer GUI (Config → Export Config). Verified 2026-06-30:
// `prusa-slicer --load config.ini -g --output model.gcode model.stl` slices
// headlessly (NO xvfb) on Debian trixie / arm64 — see docs/M1-WORKER-ENGINES.md.
const PROFILES: ProfileRef[] = [
  { id: "prusa/klipper-pla-0.2", name: "Klipper PLA 0.2mm (Prusa)", path: "/profiles/prusa-klipper-pla-0.2" },
  { id: "prusa/marlin-pla-0.2", name: "Marlin PLA 0.2mm (Prusa)", path: "/profiles/prusa-marlin-pla-0.2" },
];

export const prusa: SlicerPlugin = {
  id: "prusa",
  name: "PrusaSlicer",
  version: "0.1.0",
  stage: "slicer",
  accepts: ["stl", "3mf", "obj"],
  // The emitted flavor is governed by `gcode_flavor` in the loaded config bundle.
  // The default bundles ship klipper-flavored; this declares the adapter's
  // contract for validateStation (profile.gcode_flavor ∈ transport.acceptsFlavors).
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

    // PrusaSlicer's CLI is genuinely headless — no virtual framebuffer needed
    // (unlike Orca). Load every `.ini` in the profile bundle (a single config.ini
    // is the common case; split printer/filament/print .ini files also work, each
    // applied in load order), then slice to an exact output path. `--output <path>`
    // writes that file verbatim, so no post-rename is required.
    const configs = await loadConfigs(profile.path);
    const args: string[] = [];
    for (const cfg of configs) args.push("--load", cfg);
    args.push("--export-gcode", "--output", out, model.path);

    ctx.log(`${PRUSA_BIN} ${args.join(" ")}`);
    await run(PRUSA_BIN, args, ctx);

    return { path: out, format: "gcode", meta: { profileId } };
  },
};

/**
 * Resolve the config `.ini` file(s) to feed PrusaSlicer's repeatable `--load`.
 * Prefers a `config.ini` bundle; otherwise loads all `*.ini` in the directory
 * (alphabetical, so a `00-printer.ini`/`10-filament.ini` split applies in order).
 */
async function loadConfigs(profilePath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(profilePath);
  } catch (e) {
    throw new StageError("slicer", `profile bundle not found at ${profilePath}: ${(e as Error).message}`);
  }
  const inis = entries.filter((f) => f.toLowerCase().endsWith(".ini")).sort();
  if (inis.includes("config.ini")) return [join(profilePath, "config.ini")];
  if (inis.length === 0) {
    throw new StageError("slicer", `no .ini config found in profile bundle ${profilePath}`);
  }
  return inis.map((f) => join(profilePath, f));
}

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
