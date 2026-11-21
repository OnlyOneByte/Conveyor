# packages/worker

The BullMQ worker that drives a job through generate, slice and transport. Code in this package carries no
comments; the reasons behind it live here, one section per file.

## Dockerfile

The worker image carries the engines: OpenSCAD (generator) plus PrusaSlicer and OrcaSlicer. It is built on
the bun image, and bun runs the TypeScript worker directly with no `tsc` step.

- **Dependency stage.** Only the manifests are copied first so `bun install` stays layer-cached.
  `bun install --frozen-lockfile` validates the whole workspace graph against `bun.lock`, so every member the
  lockfile lists must be present, including `api` and `web` that the worker never imports. Leave one out and
  bun reports "lockfile had changes" and aborts.
- **PrusaSlicer** comes from apt (Debian trixie). It is multi-arch and truly headless (no xvfb), and its apt
  package pulls its own runtime libraries. It is installed on every arch.
- **OrcaSlicer** ships x86_64 and aarch64 Linux AppImages from v2.4.1. `scripts/install-orca.sh` resolves the
  AppImage for this arch from GitHub's release API and extracts it. `ORCA_RELEASE` defaults to `latest`; pass
  `x.y.z` to pin a build. Orca runs headless under xvfb: the Orca slicer plugin spawns it through
  `xvfb-run -a`. The GL/GTK libraries in the apt line (`libopengl0`, `libglu1-mesa`, `libwebkit2gtk`, the
  mesa GL/EGL drivers, gstreamer) are the minimal set found by running `--slice` in this image until it
  produced gcode. `ORCA_DATADIR` points at the bundled vendor profile tree, because Orca leaf presets resolve
  `inherits` against it.
- **OpenSCAD** is the nightly AppImage, extracted so FUSE is not needed at runtime. The distro `openscad`
  (2021.01) cannot parse the current gridfinity-rebuilt library, which needs a 2023+ nightly.
  `scripts/install-openscad.sh` resolves the latest snapshot for this arch from files.openscad.org; set
  `OPENSCAD_RELEASE=YYYY.MM.DD` or `OPENSCAD_APPIMAGE_URL=<url>` to pin one. The script writes a wrapper that
  scopes the AppImage's bundled libraries to the openscad process. A global `LD_LIBRARY_PATH` would shadow
  system libraries and break prusa-slicer, so the image never sets one.

Engine verification details: [M1-WORKER-ENGINES.md](../M1-WORKER-ENGINES.md).

## profile.ts

`resolveProfileForSlice` returns the profile directory a slicer adapter should read.

- A bundled (unedited) profile keeps its immutable `/profiles` path, and its `cleanup` is a no-op. `cleanup`
  is idempotent for both sources.
- An edited profile is re-validated at the worker trust boundary, then written under the per-job work
  directory with fixed file names only. Neither the profile id nor any request input becomes part of a
  filesystem path.
- The slicer's editable format picks the shape: Orca writes three JSON documents, Prusa writes one
  `config.ini`. A slicer with no editable format always uses its bundled path.
- Before writing, the fixed `profile` child is removed, since a crashed earlier attempt may have left it
  behind. `rm` removes a symlink rather than following it. The directory is then recreated with mode `0700`.
- The Prusa directory holds only `config.ini`, so the slicer's config loader sees exactly one config and no
  bundled `.ini` leaks in beside the edit.

## registry.ts

The worker is the only process that loads real adapters. `buildRegistry` registers every bundled plugin at
startup ([ADR 0001](../adr/0001-plugin-isolation.md): in-process adapters, isolated engines).

## status.ts

`StatusBus.publish` sends a job status event to the Redis bus and writes the durable snapshot, so a
reconnecting PWA can `GET /jobs/:id`. State is the contract: every transition is exactly one of these
messages, forwarded verbatim to the WebSocket.
