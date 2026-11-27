import type { Scene } from "../scene.ts";

const OPTION = "dialog[open] [role='option']";

export const scenes: Scene[] = [
  {
    name: "palette-slow",
    route: "/printers",
    ready: "h1",
    widths: [1440],
    fullPage: false,
    steps: [
      { lazy: "/printers" },
      { waitFor: ".cmdk" },
      { press: "Control+k" },
      { press: "t" },
      { press: "o" },
      { waitFor: "dialog[open] >> text=Loading…" },
      { release: "/printers" },
      { waitFor: `${OPTION} >> text=Go to Printers` },
      { absent: `${OPTION} >> text=Keyboard shortcuts` },
      { absent: `${OPTION} >> text=Switch theme` },
      { waitFor: "h1 >> text=Printers" },
    ],
  },
  {
    name: "palette-down",
    route: "/printers",
    ready: "h1",
    widths: [1440],
    fullPage: false,
    steps: [
      { lazy: "/printers", fail: true },
      { waitFor: ".cmdk" },
      { press: "Control+k" },
      { press: "n" },
      { waitFor: "dialog[open] >> text=Search didn't load. Reload the page to try again." },
      { waitFor: "h1 >> text=Printers" },
    ],
  },
  {
    name: "sign-in-lazy-down",
    route: "/",
    ready: "h1 >> text=Sign in",
    signedOut: true,
    widths: [1440],
    steps: [{ lazy: "/", fail: true }, { waitFor: "h1 >> text=Sign in" }, { waitFor: "#password" }],
  },
  {
    name: "auth-down-lazy-down",
    route: "/",
    ready: "h1 >> text=Can't reach Conveyor",
    authDown: { status: 503 },
    widths: [1440],
    steps: [
      { lazy: "/", fail: true },
      { waitFor: "h1 >> text=Can't reach Conveyor" },
      { waitFor: "text=Check that it's running, then try again." },
    ],
  },
];
