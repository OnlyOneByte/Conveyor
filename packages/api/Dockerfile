# Lightweight API image — no engines, just Node.
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @conveyor/shared build && pnpm --filter @conveyor/api build

FROM node:20-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
