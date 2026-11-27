FROM oven/bun:debian@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS build
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
ARG CONVEYOR_VERSION=""
RUN cd packages/web && bunx vite build

FROM node:26-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9
LABEL org.opencontainers.image.source="https://github.com/OnlyOneByte/Conveyor" \
      org.opencontainers.image.description="Conveyor web — SvelteKit + Threlte PWA" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ARG OS_REFRESH=""
RUN echo "OS package refresh: ${OS_REFRESH:-none}" \
 && apt-get update && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/packages/web
COPY --from=build /app/packages/web/build ./build
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV PORT=3000
USER 10001:10001
EXPOSE 3000
CMD ["node", "build/index.js"]
