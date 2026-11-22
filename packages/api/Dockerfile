FROM oven/bun:debian AS deps
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
RUN bun install --frozen-lockfile --production

FROM oven/bun:debian
LABEL org.opencontainers.image.source="https://github.com/OnlyOneByte/Conveyor" \
      org.opencontainers.image.description="Conveyor API — REST + WebSocket front door" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN groupadd --system --gid 10001 conveyor \
 && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/conveyor conveyor
ENV HOME=/home/conveyor
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/conveyor-entrypoint
ENTRYPOINT ["conveyor-entrypoint"]
ENV CONVEYOR_HOST=0.0.0.0
EXPOSE 3000
CMD ["bun", "packages/api/src/index.ts"]
