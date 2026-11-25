import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

const API = process.env.CONVEYOR_API_TARGET ?? "http://127.0.0.1:3000";

const VERSION = process.env.CONVEYOR_VERSION;

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

const EDITOR_MODULE = /[\\/]@codemirror[\\/]/;
const EDITOR_CHUNKS = "virtual:editor-chunks";

const editorChunks = (): Plugin => {
  let files: string[] = [];
  return {
    name: "conveyor:editor-chunks",
    apply: "build",
    generateBundle(_, bundle) {
      if (this.environment.name !== "client") return;
      const chunks = Object.values(bundle).flatMap((c) => (c.type === "chunk" ? [c] : []));
      const reached = new Set<string>();
      const reach = (file: string) => {
        if (reached.has(file)) return;
        reached.add(file);
        const chunk = bundle[file];
        if (chunk?.type === "chunk") chunk.imports.forEach(reach);
      };
      for (const chunk of chunks) if (chunk.isEntry) reach(chunk.fileName);
      files = chunks
        .filter((c) => !reached.has(c.fileName))
        .filter((c) => Object.keys(c.modules).some((id) => EDITOR_MODULE.test(id)))
        .map((c) => c.fileName);
    },
    writeBundle(options) {
      if (this.environment.name !== "client" || !options.dir) return;
      writeFileSync(join(options.dir, "..", "editor-chunks.json"), JSON.stringify(files));
    },
    resolveId: (id) => (id === EDITOR_CHUNKS ? `\0${EDITOR_CHUNKS}` : null),
    load: (id) => {
      if (id !== `\0${EDITOR_CHUNKS}`) return null;
      return `export default ${JSON.stringify(files.map((f) => `/${f}`))};`;
    },
  };
};

export default defineConfig({
  plugins: [
    chunkModules(),
    editorChunks(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter(),
      ...(VERSION ? { version: { name: VERSION } } : {}),
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
