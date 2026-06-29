# ── Conveyor worker image (M1) ────────────────────────────────────────────────
# Carries the engines: OpenSCAD (generator) + OrcaSlicer headless under xvfb
# (slicer). Built on the bun image; bun runs the TS worker directly (no tsc).
#
# ⚠️ M1 spike status: OrcaSlicer ships x86_64 Linux AppImages. On arm64 hosts the
#    orca layer is skipped (ORCA_ENABLE=0) and the worker runs with the slicer in
#    CONVEYOR_ENGINE_STUB mode. OpenSCAD is multi-arch and always installed.

FROM oven/bun:1.3.14-debian AS deps
WORKDIR /app
# Install only manifests first for layer-cached deps.
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/
COPY plugins/generators/gridfinity/package.json plugins/generators/gridfinity/
COPY plugins/slicers/orca/package.json plugins/slicers/orca/
COPY plugins/transports/moonraker/package.json plugins/transports/moonraker/
COPY plugins/transports/elegoo/package.json plugins/transports/elegoo/
RUN bun install --frozen-lockfile

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM oven/bun:1.3.14-debian
ARG ORCA_VERSION=2.4.1
ARG ORCA_ENABLE=auto
ENV ORCA_BIN=/opt/orca/AppRun

# OpenSCAD (always) + xvfb & GTK/GL libs Orca's headless CLI links against.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openscad xvfb ca-certificates curl \
      libgtk-3-0 libwebkit2gtk-4.1-0 libgl1 libegl1 libgstreamer1.0-0 fuse \
 && rm -rf /var/lib/apt/lists/*

# Extract the OrcaSlicer AppImage (x86_64 only; no-op on arm64).
COPY scripts/install-orca.sh /tmp/install-orca.sh
RUN chmod +x /tmp/install-orca.sh && /tmp/install-orca.sh "${ORCA_VERSION}" "${ORCA_ENABLE}"

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# xvfb-run wraps the worker so any GUI-linked engine has a virtual display.
CMD ["bun", "packages/worker/src/index.ts"]
