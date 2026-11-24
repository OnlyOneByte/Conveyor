import type { Viewport } from "./hits.ts";

export type Step =
  | { click: string }
  | { type: string; text: string }
  | { press: string }
  | { hover: string }
  | { scroll: string }
  | { waitFor: string; timeout?: number; warn?: string }
  | { wait: number }
  | { hits: string; viewports: readonly Viewport[] };

export interface Scene {
  name: string;
  route: string;
  ready: string;
  steps?: Step[];
  record?: boolean;
  fullPage?: boolean;
  signedOut?: boolean;
}

const keys = (...presses: string[]): Step[] =>
  presses.flatMap((press) => [{ press }, { wait: 400 }]);

export const WIDTHS = [1440, 390] as const;

export const HEIGHTS: Record<number, number> = { 1440: 900, 390: 844 };

export const scenes: Scene[] = [
  {
    name: "home",
    route: "/",
    ready: "text=Configure",
    steps: [{ wait: 1500 }],
  },
  {
    name: "nav-reach",
    route: "/",
    ready: "text=Configure",
    steps: [
      { wait: 1500 },
      {
        hits: "nav[aria-label='Main'] a, .mobile-cta button",
        viewports: [
          [390, 844],
          [390, 667],
          [700, 900],
          [1440, 900],
        ],
      },
    ],
  },
  {
    name: "upload-empty",
    route: "/",
    ready: "text=Configure",
    steps: [{ click: "button:has-text('Upload STL')" }, { wait: 800 }],
  },
  {
    name: "new-job",
    route: "/",
    ready: "text=Configure",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button:has-text('Upload STL')" },
      { wait: 700 },
      { click: "button:has-text('Generate')" },
      { wait: 700 },
      { click: "[role=radiogroup] button >> nth=-1" },
      { wait: 800 },
    ],
  },
  {
    name: "job-progress",
    route: "/",
    ready: "text=Configure",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button.desktop-print:visible, .mobile-cta button:visible" },
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
    ready: "h1",
    steps: [{ wait: 800 }],
  },
  {
    name: "job-detail",
    route: "/history/seed-canceled",
    ready: ".state",
    steps: [{ wait: 800 }],
  },
  {
    name: "job-detail-failed",
    route: "/history/seed-failed",
    ready: ".state",
    steps: [{ wait: 800 }],
  },
  {
    name: "monitor",
    route: "/monitor",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
  {
    name: "settings",
    route: "/settings",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
  {
    name: "command-menu",
    route: "/",
    ready: "text=Configure",
    steps: [{ press: "Control+k" }, { waitFor: "dialog[open] >> text=Printers" }, { wait: 300 }],
  },
  {
    name: "shortcut-sheet",
    route: "/",
    ready: "text=Configure",
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
    ready: "text=Configure",
    record: true,
    steps: [
      { wait: 800 },
      ...keys("Control+k", "j", "o", "b", "s", "Enter"),
      { waitFor: "a.jobid" },
      ...keys("j", "j", "j", "k", "?"),
    ],
  },
  {
    name: "sign-in",
    route: "/",
    ready: "text=Sign in to Conveyor",
    signedOut: true,
  },
  {
    name: "sign-in-wrong",
    route: "/",
    ready: "text=Sign in to Conveyor",
    signedOut: true,
    steps: [
      { type: "#password", text: "not the password" },
      { click: "button:has-text('Sign in')" },
      { waitFor: "text=That password didn't work" },
    ],
  },
  {
    name: "not-found",
    route: "/no-such-page",
    ready: "text=Page not found",
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
      { click: "button:has-text('Show a toast')" },
      { waitFor: ".toasts button:has-text('Print again')", timeout: 5000 },
      {
        hits: ".toasts button, nav[aria-label='Main'] a",
        viewports: [
          [390, 844],
          [390, 667],
          [700, 900],
          [1440, 900],
        ],
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
