# Lightweight API image — no engines. bun runs the TS entrypoint directly.
FROM oven/bun:1.3.14-debian AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-debian
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["bun", "packages/api/src/index.ts"]
