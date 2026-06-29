# Heavy image: carries the engines (OpenSCAD + OrcaSlicer headless under xvfb).
# The actual engine install is proven in the M1 spike; M0 ships the Node worker
# with stubbed stage calls so the topology runs end to end.
FROM node:20-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/worker ./packages/worker
COPY plugins ./plugins
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @conveyor/shared build \
 && pnpm --filter "./plugins/**" build \
 && pnpm --filter @conveyor/worker build

FROM node:20-bookworm
RUN corepack enable
# ── M1: uncomment to install the engines ──────────────────────────────
# RUN apt-get update && apt-get install -y --no-install-recommends \
#       openscad xvfb libgtk-3-0 libwebkit2gtk-4.1-0 libgl1 fuse \
#  && rm -rf /var/lib/apt/lists/*
# COPY scripts/install-orca.sh /tmp/ && /tmp/install-orca.sh "${ORCA_VERSION}"
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/worker
CMD ["node", "dist/index.js"]
