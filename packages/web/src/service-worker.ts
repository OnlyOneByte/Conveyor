/// <reference types="@sveltejs/kit" />
// Minimal offline app-shell cache. Precaches build assets so the PWA installs and
// launches offline; API/WS calls always hit the network (never cached).
import { build, files, version } from "$service-worker";

const CACHE = `conveyor-cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener("install", (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => (self as unknown as ServiceWorkerGlobalScope).skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("fetch", (event) => {
  const e = event as FetchEvent;
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Never cache API or websocket traffic. Only ASSETS paths are cached below, so this
  // is belt-and-braces — but the list must name the real API namespaces, or adding a
  // catalog path to ASSETS later would silently start serving a stale catalog.
  // ("/jobs" also covers "/jobs-history" by prefix.)
  const API_PREFIXES = ["/jobs", "/catalog", "/generators", "/uploads", "/auth"];
  if (API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  // Cache-first for precached app-shell assets.
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request)));
  }
});
