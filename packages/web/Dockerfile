# M0 web stub image. M3 swaps this for a SvelteKit (adapter-node) build.
FROM node:20-bookworm-slim
WORKDIR /app/packages/web
COPY packages/web/server.mjs ./server.mjs
COPY packages/web/public ./public
EXPOSE 3000
CMD ["node", "server.mjs"]
