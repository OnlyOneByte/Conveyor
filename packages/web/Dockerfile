# SvelteKit PWA (adapter-node). bun builds, node serves the build output.
FROM oven/bun:1.3.14-debian AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN bun install --frozen-lockfile
COPY . .
RUN cd packages/web && bunx vite build

FROM node:20-bookworm-slim
WORKDIR /app/packages/web
COPY --from=build /app/packages/web/build ./build
COPY --from=build /app/node_modules /app/node_modules
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build/index.js"]
