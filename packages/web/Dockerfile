FROM oven/bun:debian AS build
WORKDIR /app
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
COPY plugins/registry/builtin/package.json plugins/registry/builtin/
RUN bun install --frozen-lockfile
COPY . .
RUN cd packages/web && bunx vite build

FROM node:26-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/OnlyOneByte/Conveyor" \
      org.opencontainers.image.description="Conveyor web — SvelteKit + Threlte PWA" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
WORKDIR /app/packages/web
COPY --from=build /app/packages/web/build ./build
ENV PORT=3000
USER 10001:10001
EXPOSE 3000
CMD ["node", "build/index.js"]
