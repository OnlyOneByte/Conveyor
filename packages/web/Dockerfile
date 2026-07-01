# SvelteKit PWA (adapter-node). bun builds, node serves the build output.
FROM oven/bun:debian AS build
WORKDIR /app
# `bun install --frozen-lockfile` validates the ENTIRE workspace graph against
# bun.lock, so EVERY member listed in the lockfile must have its manifest present
# here — even ones this image never imports (worker + all plugins) — or bun reports
# "lockfile had changes" and aborts. (Verified 2026-06-30; same class as worker/api.)
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
COPY . .
RUN cd packages/web && bunx vite build

FROM node:lts-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/OnlyOneByte/Conveyor" \
      org.opencontainers.image.description="Conveyor web — SvelteKit + Threlte PWA" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app/packages/web
COPY --from=build /app/packages/web/build ./build
COPY --from=build /app/node_modules /app/node_modules
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build/index.js"]
