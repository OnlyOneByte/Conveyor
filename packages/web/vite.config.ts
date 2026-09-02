import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// API target is overridable for local testing on non-default ports.
const API = process.env.CONVEYOR_API_TARGET ?? "http://127.0.0.1:3000";

// Vite >=5.4.12 rejects requests whose Host header it does not recognise (DNS
// rebinding guard). Reaching the dev server through a tunnel/reverse proxy means
// the Host is the public hostname, so it must be allowed explicitly. Comma-separated;
// a leading dot matches subdomains, e.g. CONVEYOR_DEV_ALLOWED_HOSTS=.example.dev
const ALLOWED_HOSTS = (process.env.CONVEYOR_DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    ...(ALLOWED_HOSTS.length > 0 ? { allowedHosts: ALLOWED_HOSTS } : {}),
    // Dev: proxy API + WS to the api service so the PWA hits same-origin paths.
    proxy: {
      "/jobs": { target: API, ws: true },
      "/stations": { target: API },
      "/generators": { target: API },
      "/uploads": { target: API },
      "/auth": { target: API },
      "/jobs-history": { target: API },
      // /catalog/* is the durable-catalog API namespace (stations/printers/profiles).
      // Page routes deliberately never share a prefix with an API namespace — /admin and
      // /jobs both caused 404s on direct load when they did.
      "/catalog": { target: API },
    },
  },
});
