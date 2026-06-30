# Lightweight API image — no engines. bun runs the TS entrypoint directly.
FROM oven/bun:debian AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# `bun install --frozen-lockfile` validates the ENTIRE workspace graph against
# bun.lock, so EVERY member listed in the lockfile must have its manifest present
# here — even ones this image never imports (worker/web + all plugins) — or bun
# reports "lockfile had changes" and aborts. (Verified 2026-06-30.)
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

FROM oven/bun:debian
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["bun", "packages/api/src/index.ts"]
