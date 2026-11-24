import type { Scene, Step } from "./scenes.ts";

const job = (jobId: string, state: string, progress: number, gridX: number) => ({
  jobId,
  state,
  at: 1,
  progress,
  printerId: "elegoo-1",
  profileId: "orca/klipper-pla-0.2",
  generator: { id: "gridfinity", params: { gridX, gridY: 2, heightUnits: 3 } },
  createdAt: 1,
});

const live: Step = {
  fulfill: "**/api/jobs/active",
  status: 200,
  json: [
    job("b1", "slicing", 0.4, 1),
    job("b2", "printing", 0.62, 2),
    job("b3", "queued", 0, 3),
    job("b4", "queued", 0, 4),
  ],
};

const onBar: Step[] = [live, { waitFor: "#belt .bar .mini i", timeout: 8000 }, { wait: 300 }];

const onChip: Step[] = [live, { waitFor: "#belt .m .mini i", timeout: 8000 }, { wait: 300 }];

export const beltScenes: Scene[] = [
  {
    name: "belt-mobile",
    route: "/jobs",
    ready: "h1",
    widths: [390],
    fullPage: false,
    steps: onChip,
  },
  {
    name: "belt-mobile-sheet",
    route: "/jobs",
    ready: "h1",
    widths: [390],
    fullPage: false,
    steps: [
      ...onChip,
      { click: "#belt .m .exp" },
      { waitFor: "#belt .m .sheet .row" },
      { click: "#belt .m .needs" },
      { waitFor: "#belt .m .tray .btn" },
      { hits: "#belt .m .sheet a, #belt .m .sheet button", viewports: [[390, 844]] },
      { wait: 300 },
    ],
  },
  { name: "belt-bar", route: "/jobs", ready: "h1", widths: [1440], steps: onBar },
  {
    name: "belt-bar-make",
    route: "/",
    ready: "text=Configure",
    widths: [1440],
    fullPage: false,
    steps: [
      live,
      { waitFor: "#belt .chips a.chip", timeout: 8000 },
      { scroll: "button.desktop-print" },
      { waitFor: "#belt .bar .mini i" },
      { wait: 300 },
    ],
  },
  {
    name: "belt-holds-make",
    route: "/",
    ready: "text=Configure",
    widths: [1440],
    fullPage: false,
    steps: [
      live,
      { waitFor: "#belt .chips a.chip", timeout: 8000 },
      { holds: "#belt .bar", ms: 3000, scrollTo: 100, anchor: "main h1" },
    ],
  },
  {
    name: "belt-expand",
    route: "/jobs",
    ready: "h1",
    widths: [1440],
    record: true,
    steps: [
      ...onBar,
      { click: "#belt .bar .exp" },
      { waitFor: "#belt .shut:focus" },
      { wait: 800 },
      { press: "Escape" },
      { waitFor: "#belt .bar .exp:focus" },
      { wait: 500 },
    ],
  },
];
