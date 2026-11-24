import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { precached } from "./precache";

const CACHE = `conveyor-cache-${version}`;
const ASSETS = precached([...immutable, ...assets].map(({ path }) => path));

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
  if (url.pathname.startsWith("/api/")) return;
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request)));
  }
});
