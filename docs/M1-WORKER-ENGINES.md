# M1 — Worker engines (OpenSCAD + OrcaSlicer headless)

Goal: the worker image can do a **real** generate + slice — OpenSCAD produces an STL,
OrcaSlicer slices it to gcode headlessly — replacing the M0 stubs.

## Status: ✅ VERIFIED green (2026-06-30)

Both engines do a **real** generate + slice headless on aarch64 — generator
(OpenSCAD) and **both** slicers (PrusaSlicer + OrcaSlicer). The earlier "Orca is
x86_64-only, verify on a NUC" caveat is **obsolete**: as of **OrcaSlicer v2.4.1**
SoftFever ships a native **Linux aarch64 AppImage**, and it slices clean in this
exact base image (proof below). (The macOS `.dmg` remains a dead end for the worker —
it's a Mach-O binary, which a Linux container can't exec regardless of host CPU.)

## Generator half: ✅ VERIFIED (2026-06-29)

The gridfinity generator now produces **real, dimensionally-correct** STLs. Verified by
rendering in an arm64 Debian container with OpenSCAD 2023.09 nightly (the host AppImage
needs GLIBC 2.28 > AL2's, so Docker is the verification path — which is also how the
worker runs it in prod):

- **2×3 default bin → 83.5 × 125.5mm** (exactly 2×42−0.5 × 3×42−0.5, the Gridfinity spec).
- **4×2×9 + 3 divisions + scoop + label + magnets → 167.5 × 83.5mm**, 25 454 vertices, manifold.

Findings the render-test caught (the M0 stub hid all of these — every real render would
have failed on the old defines):

| Was (M0 guess) | Correct (verified) |
|---|---|
| entry file `gridfinity.scad` | `gridfinity-rebuilt-bins.scad` |
| `enable_scoop` (bool) | `scoop` ∈ [0..1] float |
| `enable_label` (bool) | `style_tab` (0=Full…5=None) |
| `enable_magnet` | `magnet_holes` |
| `enable_lip` | `include_lip` |
| — | **`magnet_holes=true` requires `refined_holes=false`** (lib assertion; else empty object) |

All fixed in `plugins/generators/gridfinity/src/index.ts` `toScadDefines()`.

**OpenSCAD version coupling:** the current lib (HEAD, "gridfinity-rebuilt-2") uses syntax
the stable **2021.01** can't parse (`syntax error … line 125`). It needs a 2023+
**nightly/development snapshot** (the lib README recommends this; also a 10min→sec render
speedup). The worker Dockerfile extracts a nightly AppImage, not the distro stable.
`scripts/install-openscad.sh` tracks the **latest** snapshot for the host arch from
`files.openscad.org/snapshots/` (scrapes the listing, picks the newest date across both
the `.ai-<arch>` and `-<arch>` naming patterns; `OPENSCAD_RELEASE`/`OPENSCAD_APPIMAGE_URL`
override). Note: upstream currently ships **aarch64** nightlies only up to **2023.09.11**
(the verified-working build), while x86_64 gets ongoing nightlies — so on this box "latest"
resolves to 2023.09.11.

The SCAD lib is vendored as a submodule (`scad/gridfinity-rebuilt-openscad`, HEAD @ 2025-08).
Run `git submodule update --init` after clone.

## Full pipeline: ✅ VERIFIED end-to-end (2026-06-30)

The **real worker registry** was driven through generate → slice **inside the built
worker image** (`packages/worker/Dockerfile`), proving the two multi-arch engines chain
through the actual `buildRegistry()` + `StageCtx` contract — not isolated calls:

- **generate** gridfinity 2×3×6 (scoop + label + magnets) → real **6.1 MB STL**,
  bbox **83.5 × 125.5 × 45.5 mm** (exact Gridfinity spec) via OpenSCAD 2023.09 nightly.
- **slice** that STL → real **3.9 MB G-code, 228 layers** via PrusaSlicer 2.9.2 (headless).

(Transport stage needs hardware, so the E2E stops after slice — see `docs/M2-TRANSPORTS.md`.)

## OrcaSlicer half: ✅ VERIFIED on aarch64 (2026-06-30)

The unlock was the **Linux aarch64 AppImage** added in **v2.4.1**
(`OrcaSlicer_Linux_AppImage_Ubuntu2404_aarch64_V2.4.1.AppImage`) — a genuine ELF
arm64 binary. Extracted into the worker base image (`oven/bun:1.3.14-debian`) and
driven headless under `xvfb`, it sliced a 20 mm cube → **`plate_1.gcode` (449 KB,
100 layers), exit 0**, with a real OrcaSlicer 2.4.1 header — on this aarch64 box.

**Ground-truth CLI** (captured from `--help` in the image; corrected the adapter's
prior guesses):

| Concern | Verified answer |
|---|---|
| Action verb | **`--slice 0`** (0 = all plates). There is **no** `--export-gcode`/`--output`. |
| Machine + process | ONE arg: `--load-settings "machine.json;process.json"` (`;`-separated). |
| Filament(s) | `--load-filaments "f1.json;f2.json"`. |
| Output | `--outputdir <dir>` — a **directory**; Orca writes **`plate_1.gcode`** (+ `result.json`), *not* a model-named file. |
| Inheritance | Leaf presets use `inherits` → **`--datadir <vendor-profile-tree>`** must be set or load fails (`-3`). |
| CLI priority | command-line settings > `--load-settings`/`--load-filaments` > 3MF embedded. |

**Runtime libs** the headless binary needs (beyond the OpenSCAD set), found by
running `--slice` until it stopped erroring on a missing `.so` (plus `xauth`, which
`xvfb-run` requires — caught by the full-image E2E below):
`xauth libopengl0 libglu1-mesa libgl1-mesa-dri libglx-mesa0 libgles2 libgtk-3-0
libwebkit2gtk-4.1-0 libegl1 libgstreamer1.0-0 libgstreamer-plugins-base1.0-0
libsecret-1-0 libsoup-3.0-0 libxext6 libsm6 libice6 libnotify4 libgdk-pixbuf-2.0-0`
— all baked into `packages/worker/Dockerfile`.

**Profile caveat:** the slice fails on a **config** issue, not the engine, if the
chosen preset uses relative-E addressing without a `G92 E0` in its layer-change
gcode (Orca's normative check, `-51`). `--no-check` only skips *path-conflict*
checks, not this one. A real vendor preset for a native-Klipper printer satisfies
it — the shipped bundle (Creality K1) sets `before_layer_change_gcode` with `G92 E0`.
Note a **thin `inherits`-only wrapper or generic `MyKlipper` base fails `-17`**
(filament↔machine compatibility / config conflict); ship **verbatim vendor leaf
exports** instead.

### Turnkey Orca bundle: ✅ shipped & E2E-verified

`profiles/orca-klipper-pla-0.2/` holds verbatim OrcaSlicer leaf exports for the
**Creality K1** family (`machine.json` + `process.json` + `filament.json`); their
`inherits` parents resolve against `ORCA_DATADIR`. The seed binds the `garage-klipper`
and `elegoo-pla` Stations to `orca/klipper-pla-0.2`.

**Full generate→slice E2E in the rebuilt worker image (2026-06-30)** — real
`buildRegistry()` + `StageCtx`, the actual Dockerfile (downloads the aarch64 AppImage,
installs libs, sets `ORCA_DATADIR`):

- **generate** gridfinity 2×3×6 → **6.13 MB STL** (OpenSCAD nightly via scoped wrapper)
- **slice** that STL via OrcaSlicer → **4.38 MB G-code, `gcode_flavor = klipper`, 228 layers**

The rebuild caught one real bug: `xvfb-run` needs **`xauth`** (was missing from the
apt list — the standalone probes had pulled it transitively). Fixed in the Dockerfile.

Two real integration bugs this caught — **invisible to per-engine tests**, surfaced only
by running both engines in one image:

1. **`bun install --frozen-lockfile` validates the WHOLE workspace graph.** The worker/api
   deps stages copied only the manifests they import, but the lockfile knows all 10 members
   — so bun saw a "changed" workspace and aborted. Adding any new member (e.g. the prusa
   package) triggers it. Fix: copy **every** workspace `package.json` in the deps stage of
   both `packages/worker/Dockerfile` and `packages/api/Dockerfile`.
2. **A global `LD_LIBRARY_PATH` for OpenSCAD's bundled libs broke PrusaSlicer.** The
   AppImage ships an older `libgnutls.so.30`; exporting `LD_LIBRARY_PATH=/opt/openscad/usr/lib`
   image-wide shadowed the system lib, so prusa-slicer failed to start
   (`GNUTLS_3_7_2 not found`). Fix: `scripts/install-openscad.sh` writes a wrapper at
   `/opt/openscad/bin/openscad` that scopes the bundled libs to the openscad process only;
   `OPENSCAD_BIN` points at the wrapper and **no** global `LD_LIBRARY_PATH` is set.

## What's wired

- `packages/worker/Dockerfile` — `oven/bun` base; installs OpenSCAD + PrusaSlicer +
  xvfb + the verified GTK/GL lib set; runs `scripts/install-orca.sh` (arch-aware:
  x86_64 **and** aarch64); sets `ORCA_DATADIR` to the bundled vendor profile tree.
- `scripts/install-orca.sh` — resolves the Linux AppImage asset for this arch from
  GitHub's release API (latest by default; `ORCA_RELEASE=x.y.z` to pin a build),
  downloads + `--appimage-extract`s to `/opt/orca/AppRun`. Discovering the asset URL
  from the API is more robust than guessing filenames (which vary by release).
- `plugins/slicers/orca/src/index.ts` — real path runs
  `xvfb-run -a $ORCA_BIN --datadir … --load-settings … --load-filaments … --slice 0
  --outputdir …` and normalizes `plate_1.gcode` → `model.gcode`.
- `plugins/slicers/prusa/src/index.ts` — the other verified slicer (apt, no xvfb).
- `profiles/`, `scad/` — read-only mount points with structure docs.

## Shipping an Orca station: ✅ done (one bundle)

The engine + CLI + image + a turnkey bundle are all proven (see above). What landed:

1. ✅ **Real Orca profile bundle shipped** — `profiles/orca-klipper-pla-0.2/`
   (verbatim Creality K1 leaf exports). The seed's two Orca Stations bind to it, and
   the full generate→slice E2E ran green in the rebuilt image.
2. ✅ **Tracks the latest release** — `install-orca.sh` resolves the newest Orca
   AppImage from GitHub's API at build time (no version/checksum pinning). This is a
   personal self-host pulling from the official upstream release; tracking latest is
   the intended posture. To freeze a build, pass `ORCA_RELEASE=x.y.z`.

Optional follow-up (not a blocker):

3. **More bundles** — add per-printer dirs (`profiles/orca-<id>/`) from the GUI
   (Profile → Export) and a `Profile` seed row / admin entry. Keep them Klipper- or
   Marlin-flavored to match the transport's `acceptsFlavors`. A dedicated Marlin Orca
   bundle would round out the set (prusa already ships one).

## Note: PrusaSlicer is the verified default slicer

Both slicers now work on this box, but **PrusaSlicer** is the simpler default — apt
install, genuinely headless (no xvfb), single `config.ini` bundle, and its profiles
are already committed under `profiles/prusa-*`. Orca is fully supported as a second,
pluggable engine (ADR 0001) for users who prefer its profile ecosystem.
