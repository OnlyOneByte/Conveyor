# ── Conveyor worker image (M1) ────────────────────────────────────────────────
# Carries the engines: OpenSCAD (generator) + slicers. Built on the bun image;
# bun runs the TS worker directly (no tsc).
#
# Slicers:
#   • PrusaSlicer — multi-arch (apt, Debian trixie), genuinely headless (no xvfb).
#     Installed on every arch. Verified slicing an STL → gcode 2026-06-30.
#   • OrcaSlicer  — ships BOTH x86_64 and aarch64 Linux AppImages (v2.4.1+). Runs
#     headless under xvfb. Verified slicing an STL → 449KB gcode (100 layers) in
#     THIS base image on aarch64 2026-06-30 (see docs/M1-WORKER-ENGINES.md).
# OpenSCAD (generator) is multi-arch and always installed.

FROM oven/bun:debian AS deps
WORKDIR /app
# Install only manifests first for layer-cached deps. `bun install --frozen-lockfile`
# validates the ENTIRE workspace graph against bun.lock, so EVERY member listed in
# the lockfile must be present here — even api/web that the worker never imports —
# or bun reports "lockfile had changes" and aborts. (Verified 2026-06-30.)
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/worker/package.json packages/worker/
COPY plugins/generators/gridfinity/package.json plugins/generators/gridfinity/
COPY plugins/generators/passthrough/package.json plugins/generators/passthrough/
COPY plugins/slicers/orca/package.json plugins/slicers/orca/
COPY plugins/slicers/prusa/package.json plugins/slicers/prusa/
COPY plugins/transports/moonraker/package.json plugins/transports/moonraker/
COPY plugins/transports/elegoo/package.json plugins/transports/elegoo/
RUN bun install --frozen-lockfile

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM oven/bun:debian
# Track the latest OrcaSlicer release by default; pass ORCA_RELEASE=x.y.z to pin a build.
ARG ORCA_RELEASE=latest
ARG ORCA_ENABLE=auto
ENV ORCA_BIN=/opt/orca/AppRun

# Runtime libs for OpenSCAD nightly + xvfb & GTK/GL libs Orca's headless CLI links against.
# `prusa-slicer` (apt) is the multi-arch, headless-verified slicer — it pulls its own
# runtime deps via apt, so installing it here is enough (no AppImage, no xvfb).
# NOTE: the distro-stable `openscad` (2021.01) CANNOT parse the current
# gridfinity-rebuilt lib (needs a 2023+ nightly — verified, see docs/M1-WORKER-ENGINES.md),
# so we extract the nightly AppImage instead of apt-installing stable openscad.
# The OrcaSlicer GL/GTK runtime libs (libopengl0, libglu1-mesa, libwebkit2gtk,
# mesa GL/EGL drivers, gstreamer) were verified-minimal by extracting the aarch64
# AppImage and running --slice in this image until it produced gcode (2026-06-30).
RUN apt-get update && apt-get install -y --no-install-recommends \
      prusa-slicer \
      xvfb xauth ca-certificates curl \
      libharfbuzz0b libgpg-error0 libgcrypt20 libglib2.0-0 libfontconfig1 libfreetype6 libgomp1 \
      libgtk-3-0 libwebkit2gtk-4.1-0 libgl1 libegl1 libgstreamer1.0-0 fuse \
      libopengl0 libglu1-mesa libgl1-mesa-dri libglx-mesa0 libgles2 \
      libgstreamer-plugins-base1.0-0 libsecret-1-0 libsoup-3.0-0 \
      libxext6 libsm6 libice6 libnotify4 libgdk-pixbuf-2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# OpenSCAD nightly (multi-arch AppImage, extracted — no FUSE needed at runtime).
# Resolves the LATEST snapshot for this arch from files.openscad.org at build time
# (set OPENSCAD_RELEASE=YYYY.MM.DD or OPENSCAD_APPIMAGE_URL=<url> to pin a build).
# The install script writes a wrapper that scopes the AppImage's bundled libs to
# the openscad process only — we deliberately do NOT set a global LD_LIBRARY_PATH,
# which would shadow system libs and break prusa-slicer (verified 2026-06-30).
COPY scripts/install-openscad.sh /tmp/install-openscad.sh
RUN chmod +x /tmp/install-openscad.sh && /tmp/install-openscad.sh
ENV OPENSCAD_BIN=/opt/openscad/bin/openscad

# Extract the OrcaSlicer AppImage (x86_64 AND aarch64 supported as of v2.4.1).
# Resolves the Linux AppImage asset for this arch from GitHub's release API
# (latest by default — set ORCA_RELEASE=x.y.z to pin a specific build).
COPY scripts/install-orca.sh /tmp/install-orca.sh
RUN chmod +x /tmp/install-orca.sh && /tmp/install-orca.sh "${ORCA_RELEASE}" "${ORCA_ENABLE}"
# Orca leaf presets resolve `inherits` against the bundled vendor profile tree.
ENV ORCA_DATADIR=/opt/orca/squashfs-root/resources/profiles

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# xvfb-run wraps the worker so any GUI-linked engine has a virtual display.
CMD ["bun", "packages/worker/src/index.ts"]
