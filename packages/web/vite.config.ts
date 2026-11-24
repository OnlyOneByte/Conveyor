import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const API = process.env.CONVEYOR_API_TARGET ?? "http://127.0.0.1:3000";

const ALLOWED_HOSTS = (process.env.CONVEYOR_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const chunkModules = (): Plugin => ({
  name: "conveyor:chunk-modules",
  apply: "build",
  writeBundle(options, bundle) {
    if (!options.dir?.endsWith(join("output", "client")) || "service-worker.js" in bundle) return;
    const modules = Object.fromEntries(
      Object.values(bundle).flatMap((chunk) =>
        chunk.type === "chunk" ? [[chunk.fileName, Object.keys(chunk.modules)]] : [],
      ),
    );
    writeFileSync(join(options.dir, "..", "chunk-modules.json"), JSON.stringify(modules));
  },
});

export default defineConfig({
  plugins: [
    chunkModules(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter(),
      csp: {
        mode: "auto",
        directives: {
          "default-src": ["self"],
          "script-src": ["self"],
          "style-src": ["self", "unsafe-inline"],
          "img-src": ["self", "data:", "blob:"],
          "connect-src": ["self"],
          "worker-src": ["self"],
          "object-src": ["none"],
          "base-uri": ["self"],
          "form-action": ["self"],
          "frame-ancestors": ["none"],
        },
      },
    }),
  ],
  server: {
    ...(ALLOWED_HOSTS.length > 0 ? { allowedHosts: ALLOWED_HOSTS } : {}),
    proxy: {
      "^/api/": { target: API, ws: true, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
});
