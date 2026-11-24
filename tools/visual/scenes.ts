import type { Viewport } from "./hits.ts";
import { REACH, toastOnMake } from "./reach.ts";
import { beltScenes } from "./scenes-belt.ts";
import { liveScenes } from "./scenes-live.ts";
import { makeScenes } from "./scenes-make.ts";
import { receiptScenes } from "./scenes-receipt.ts";
import { settingsScenes } from "./scenes-settings.ts";
import { signedOutScenes } from "./scenes-signed-out.ts";

export type Step =
  | { click: string }
  | { type: string; text: string }
  | { press: string }
  | { hover: string }
  | { scroll: string }
  | { waitFor: string; timeout?: number; warn?: string }
  | { wait: number }
  | { fulfill: string; method?: string; status: number; json: unknown }
  | { follow: string }
  | { upload: string; name: string; text: string }
  | { history: "back" | "forward"; url?: string }
  | { hits: string; viewports: readonly Viewport[] }
  | { holds: string; ms: number; scrollTo: number; anchor: string }
  | { still: string; ms: number };

export interface Scene {
  name: string;
  route: string;
  ready: string;
  steps?: Step[];
  record?: boolean;
  fullPage?: boolean;
  signedOut?: boolean;
  reducedMotion?: boolean;
  widths?: readonly (typeof WIDTHS)[number][];
  height?: number;
}

const keys = (...presses: string[]): Step[] =>
  presses.flatMap((press) => [{ press }, { wait: 400 }]);

export const WIDTHS = [1440, 390] as const;

export const HEIGHTS: Record<number, number> = { 1440: 900, 390: 844 };

export const scenes: Scene[] = [
  {
    name: "home",
    route: "/",
    ready: "text=How big?",
    steps: [{ wait: 1500 }],
  },
  {
    name: "nav-reach",
    route: "/primitives",
    ready: "text=Primitives",
    steps: [
      ...toastOnMake,
      {
        hits: "nav[aria-label='Main'] a, .dock button, .toasts button",
        viewports: REACH,
      },
    ],
  },
  {
    name: "new-job",
    route: "/",
    ready: "text=How big?",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button:has-text('Upload STL')" },
      { wait: 700 },
      { click: "role=tab[name='Gridfinity Bin']" },
      { wait: 700 },
      { click: "label.pill >> nth=-1" },
      { wait: 800 },
    ],
  },
  {
    name: "job-progress",
    route: "/",
    ready: "text=How big?",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button.print" },
      { scroll: "ol.stages, .status" },
      {
        waitFor: "ol.stages li.done:last-child, .status .failed",
        timeout: 12000,
      },
      { wait: 800 },
    ],
  },
  {
    name: "history",
    route: "/history",
    ready: "tbody tr a.jobid",
    steps: [{ wait: 800 }],
  },
  ...receiptScenes,
  ...liveScenes,
  ...makeScenes,
  {
    name: "monitor",
    route: "/monitor",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
  ...settingsScenes,
  {
    name: "command-menu",
    route: "/",
    ready: "text=How big?",
    steps: [{ press: "Control+k" }, { waitFor: "dialog[open] >> text=Printers" }, { wait: 300 }],
  },
  ...["done", "2 x 3"].map((text) => ({
    name: `command-menu-${text.replaceAll(" ", "")}`,
    route: "/",
    ready: "text=How big?",
    steps: [
      { press: "Control+k" },
      { type: "dialog[open] input", text },
      { waitFor: "role=option[name=/^Gridfinity Bin 2×3 · 6u , Elegoo Neptune · Printed · /]" },
      { wait: 300 },
    ],
  })),
  {
    name: "shortcut-sheet",
    route: "/",
    ready: "text=How big?",
    steps: [{ wait: 500 }, ...keys("?"), { click: "dialog[open] >> [role=switch]" }, { wait: 300 }],
  },
  {
    name: "jobs-keys",
    route: "/history",
    ready: "a.jobid",
    steps: [
      { wait: 500 },
      ...keys("j", "j"),
      { waitFor: "tr:nth-child(2) a.jobid:focus", timeout: 5000 },
    ],
  },
  {
    name: "keyboard",
    route: "/",
    ready: "text=How big?",
    record: true,
    steps: [
      { wait: 800 },
      ...keys("Control+k", "j", "o", "b", "s", "Enter"),
      { waitFor: "a.jobid" },
      ...keys("j", "j", "j", "k", "?"),
    ],
  },
  ...["0", "1", "3", "8", "20", "states"].map((jobs) => ({
    name: `track-${jobs}`,
    route: `/primitives/track?jobs=${jobs}`,
    ready: "h1",
    steps: [{ wait: 600 }],
  })),
  ...signedOutScenes,
  ...beltScenes,
  {
    name: "track-keys",
    route: "/primitives/track?jobs=8",
    ready: "h1",
    record: true,
    steps: [
      { wait: 600 },
      ...keys("Tab", "Enter", "Tab"),
      { waitFor: "button.grp:focus", timeout: 5000 },
      ...keys("ArrowRight", "ArrowRight"),
      { waitFor: ".card li:nth-child(2) a:focus", timeout: 5000 },
      ...keys("ArrowRight", "ArrowDown"),
      { waitFor: ".card a.btn:focus", timeout: 5000 },
      ...keys("Escape"),
      { waitFor: "a.chip.s-printing:focus", timeout: 5000 },
    ],
  },
  {
    name: "track-card",
    route: "/primitives/track?jobs=3",
    ready: "h1",
    steps: [
      { hover: "a.chip.s-printing" },
      { waitFor: ".card .btn", timeout: 5000 },
      { wait: 300 },
    ],
  },
  {
    name: "primitives",
    route: "/primitives",
    ready: "text=Primitives",
    steps: [
      { click: "button:has-text('Show a toast')" },
      { hover: "button:has-text('Secondary')" },
      ...keys("Tab", "Tab", "Tab", "Tab", "Tab"),
      { wait: 6500 },
    ],
  },
  {
    name: "toast-reach",
    route: "/primitives",
    ready: "text=Primitives",
    steps: [
      ...toastOnMake,
      {
        hits: ".toasts button, .dock button, nav[aria-label='Main'] a",
        viewports: REACH,
      },
    ],
  },
  {
    name: "primitives-fields",
    route: "/primitives",
    ready: "text=Fields",
    steps: [{ click: "text=Name" }, { wait: 400 }],
  },
  {
    name: "primitives-dialog",
    route: "/primitives",
    ready: "text=Primitives",
    steps: [
      { click: "button:has-text('Open dialog')" },
      { waitFor: "dialog select:focus", timeout: 5000 },
      ...keys("Tab"),
      { waitFor: "dialog textarea:focus", timeout: 5000 },
      ...keys("Tab", "Tab", "Tab"),
      { waitFor: "dialog select:focus", timeout: 5000 },
      ...keys("Shift+Tab"),
      { waitFor: "dialog button:has-text('Cancel job'):focus", timeout: 5000 },
    ],
  },
  {
    name: "primitives-keys",
    route: "/primitives",
    ready: "text=Primitives",
    record: true,
    steps: keys(
      ...["Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Enter", "Tab", "Escape"],
      ...["Tab", "Enter", "ArrowDown", "ArrowDown", "Escape"],
    ),
  },
];
