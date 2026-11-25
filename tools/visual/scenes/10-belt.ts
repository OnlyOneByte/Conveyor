import type { Scene, Step } from "../scene.ts";

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

const ends = (jobId: string, state: string): Step => ({
  fulfill: `**/api/jobs/${jobId}`,
  status: 200,
  json: {
    jobId,
    state,
    at: 2,
    ...(state === "failed" ? { error: { stage: "slicer", reason: "no profile" } } : {}),
  },
});

const moves: Step[] = [
  {
    fulfill: "**/api/jobs/active",
    status: 200,
    json: [
      job("m1", "slicing", 0.2, 1),
      job("m2", "printing", 0.15, 2),
      job("m3", "printing", 0.95, 3),
      job("m4", "transferring", 0.5, 4),
      job("m5", "generating", 0.5, 5),
    ],
  },
  { waitFor: "#belt .chips a.chip", timeout: 8000 },
  { wait: 1500 },
  ends("m3", "done"),
  ends("m4", "failed"),
  ends("m5", "canceled"),
  {
    fulfill: "**/api/jobs/active",
    status: 200,
    json: [job("m1", "slicing", 0.9, 1), job("m2", "printing", 0.5, 2)],
  },
];

const onChip: Step[] = [live, { waitFor: "#belt .m .mini i", timeout: 8000 }, { wait: 300 }];

const down = (route: string): Step => ({ fulfill: route, status: 503, json: { error: "down" } });

const offline: Step[] = [
  down("**/api/jobs/active"),
  down("**/api/jobs-history?*"),
  down("**/api/jobs-history/counts?*"),
  down("**/api/jobs/needs-you"),
  { waitFor: "text=Can't reach Conveyor >> visible=true", timeout: 15000 },
  { wait: 400 },
];

const region: Step = { waitFor: 'role=region[name="On the belt"s] >> visible=true', timeout: 8000 };
const collapsed: Step = { waitFor: "#belt .bar:visible, #belt section.m:visible", timeout: 8000 };

export const scenes: Scene[] = [
  {
    name: "belt-mobile",
    route: "/history",
    ready: "h1",
    widths: [390],
    fullPage: false,
    steps: onChip,
  },
  {
    name: "belt-mobile-sheet",
    route: "/history",
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
  { name: "belt-bar", route: "/history", ready: "h1", widths: [1440], steps: onBar },
  {
    name: "belt-bar-make",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    height: 720,
    fullPage: false,
    steps: [
      live,
      { waitFor: "#belt .chips a.chip", timeout: 8000 },
      { press: "End" },
      { waitFor: "#belt .bar .mini i" },
      { wait: 300 },
    ],
  },
  {
    name: "belt-holds-make",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    height: 720,
    fullPage: false,
    steps: [
      live,
      { waitFor: "#belt .chips a.chip", timeout: 8000 },
      { holds: "#belt .bar", ms: 3000, scrollTo: 100, anchor: "main h1" },
    ],
  },
  {
    name: "belt-expand",
    route: "/history",
    ready: "h1",
    widths: [1440],
    record: true,
    steps: [
      ...onBar,
      { hits: "#belt .bar .exp, #belt .bar a", viewports: [[1440, 900]] },
      { click: "#belt .bar .exp" },
      { waitFor: "#belt .shut:focus" },
      { hits: "#belt .shut, #belt .bins a, #belt .bins button", viewports: [[1440, 900]] },
      { wait: 800 },
      { press: "Escape" },
      { waitFor: "#belt .bar .exp:focus" },
      { wait: 500 },
    ],
  },
  {
    name: "belt-motion",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    fullPage: false,
    record: true,
    steps: [...moves, { waitFor: "#belt .chips .gone a.chip", timeout: 8000 }, { wait: 1500 }],
  },
  {
    name: "belt-motion-reduced",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    fullPage: false,
    record: true,
    reducedMotion: true,
    steps: [...moves, { still: "#belt", ms: 3000 }],
  },
  { name: "belt-offline", route: "/history", ready: "h1", steps: offline },
  {
    name: "belt-offline-make",
    route: "/",
    ready: "text=Configure",
    widths: [1440],
    fullPage: false,
    steps: offline,
  },
  {
    name: "belt-region",
    route: "/",
    ready: "text=Configure",
    fullPage: false,
    steps: [
      region,
      { follow: "/history" },
      { wait: 800 },
      region,
      collapsed,
      { follow: "/settings" },
      { wait: 800 },
      region,
      collapsed,
      { follow: "/monitor" },
      { wait: 800 },
      region,
      collapsed,
      { follow: "/jobs/seed-printed" },
      { wait: 800 },
      region,
      collapsed,
    ],
  },
];
