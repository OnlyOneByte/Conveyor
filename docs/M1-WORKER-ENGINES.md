# M1 — Worker engines (OpenSCAD + OrcaSlicer headless)

Goal: the worker image can do a **real** generate + slice — OpenSCAD produces an STL,
OrcaSlicer slices it to gcode headlessly — replacing the M0 stubs.

## Status: spike scaffold (NOT yet verified green)

The image, install script, and adapter invocations are authored, but a full
build-and-slice has **not** been run to success in this environment. Two real
constraints make that a deliberate next step rather than a here-and-now check:

1. **Architecture.** OrcaSlicer ships **x86_64** Linux AppImages only. The dev box is
   aarch64, so `install-orca.sh` no-ops there and the slicer falls back to stub mode.
   Build/verify on an x86_64 host (most self-host mini-PCs/NUCs qualify).
2. **Image size / time.** The Orca layer pulls a multi-GB toolchain; a real slice test
   is a minutes-long build, not a quick loop.

OpenSCAD is multi-arch and installs everywhere, so the **generator** half of M1 is
verifiable on any host.

## What's wired

- `packages/worker/Dockerfile` — `oven/bun` base; installs OpenSCAD + xvfb + GTK/GL
  libs; runs `scripts/install-orca.sh` (arch-aware, skips on non-x86_64).
- `scripts/install-orca.sh` — downloads + `--appimage-extract`s OrcaSlicer to
  `/opt/orca/AppRun`. Tries several asset-name patterns (they vary by release).
- `plugins/slicers/orca/src/index.ts` — real path runs `xvfb-run -a $ORCA_BIN --slice …`.
- `profiles/`, `scad/` — read-only mount points with structure docs.

## The checklist to turn it green (on an x86_64 host)

1. **Pin the AppImage asset.** Confirm the exact v2.4.1 Linux AppImage filename on the
   releases page and lock it in `install-orca.sh` CANDIDATES (the patterns are guesses).
2. **Confirm the CLI flags** — run `/opt/orca/AppRun --help` in the container. Verify:
   - settings load form: ONE `--load-settings "machine.json;process.json"` vs repeated flags
   - `--load-filaments` name
   - output: `--outputdir` vs `--output`, and the produced gcode filename
   - the `--slice 0` / `--export-slicedata` semantics
   Correct `plugins/slicers/orca/src/index.ts` to match.
3. **Export real profiles** from OrcaSlicer GUI → drop into `profiles/<id>/`.
4. **Vendor the SCAD lib** — `git submodule add …/gridfinity-rebuilt-openscad scad/…`
   and confirm the `-D` variable names in the generator match the lib.
5. **Slice a known STL** end-to-end with `CONVEYOR_ENGINE_STUB` unset; diff the gcode
   header for the expected printer/filament.
6. **xvfb sanity** — if Orca still complains about a display, try
   `xvfb-run -a -s "-screen 0 1280x1024x24"`.

## Fallback

If Orca's headless CLI proves too brittle, the slicer seam is pluggable (ADR 0001):
a **PrusaSlicer CLI** adapter (`prusa-slicer --load … --export-gcode`) is rock-solid
headless and shares Orca's profile lineage. Same `SlicerPlugin` interface, ~one file.
