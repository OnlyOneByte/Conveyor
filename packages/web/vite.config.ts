import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

const API = process.env.CONVEYOR_API_TARGET ?? "http://127.0.0.1:3000";

const ALLOWED_HOSTS = (process.env.CONVEYOR_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    ...(ALLOWED_HOSTS.length > 0 ? { allowedHosts: ALLOWED_HOSTS } : {}),
    proxy: {
      "/jobs": { target: API, ws: true },
      "/generators": { target: API },
      "/uploads": { target: API },
      "/auth": { target: API },
      "/jobs-history": { target: API },
      "/catalog": { target: API },
    },
  },
});
