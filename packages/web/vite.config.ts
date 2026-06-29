import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// API target is overridable for local testing on non-default ports.
const API = process.env.CONVEYOR_API_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // Dev: proxy API + WS to the api service so the PWA hits same-origin paths.
    proxy: {
      "/jobs": { target: API, ws: true },
      "/stations": { target: API },
      "/generators": { target: API },
    },
  },
});
