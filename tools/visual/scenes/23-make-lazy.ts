import type { Scene } from "../scene.ts";

const LOADING = "[data-loading='Loading Make']";
const TITLE = "h1 >> text=What are we making?";
const DOWN = "[role=alert] >> text=/Make's form didn't load\\. Check your connection/";
const AGAIN = "main button >> text=Try again";
const CHUNKS = "**/_app/immutable/chunks/*.js";

export const scenes: Scene[] = [
  {
    name: "make-form-lazy",
    route: "/",
    ready: "header",
    widths: [1440, 390],
    fullPage: false,
    steps: [
      { lazy: "/" },
      { waitFor: LOADING },
      { absent: TITLE },
      { wait: 400 },
      { release: "/" },
      { waitFor: TITLE },
      { waitFor: "text=How big?" },
      { absent: LOADING },
      { wait: 400 },
    ],
  },
  {
    name: "make-form-down",
    route: "/",
    ready: "header",
    widths: [1440, 390],
    fullPage: false,
    steps: [
      { lazy: "/", fail: true },
      { waitFor: DOWN },
      { waitFor: AGAIN },
      { named: AGAIN },
      { absent: "text=How big?" },
      { reconnect: "/" },
      { click: AGAIN },
      { waitFor: "text=How big?" },
      { absent: "[role=alert]" },
      { wait: 400 },
    ],
  },
  {
    name: "make-form-retry-pending",
    route: "/",
    ready: "header",
    widths: [1440],
    fullPage: false,
    steps: [
      { lazy: "/", fail: true },
      { waitFor: AGAIN },
      { reconnect: "/" },
      { stall: CHUNKS, status: 503, json: {} },
      { click: AGAIN },
      { waitFor: "main button[aria-busy='true']:focus >> text=Loading…" },
      { named: "main button[aria-busy='true']" },
      { click: "main button[aria-busy='true']" },
      { release: CHUNKS, fail: true },
      { waitFor: "main button:not([aria-busy='true']) >> text=Try again" },
      { waitFor: DOWN },
      { absent: "text=How big?" },
    ],
  },
];
