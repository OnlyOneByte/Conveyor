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

const motion: Step[] = [
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
  { waitFor: "#belt .chips .gone", timeout: 8000 },
  { wait: 1500 },
];

export const beltScenes: Scene[] = [
  { name: "belt-bar", route: "/history", ready: "h1", widths: [1440], steps: onBar },
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
    route: "/history",
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
  {
    name: "belt-motion",
    route: "/",
    ready: "text=Configure",
    widths: [1440],
    fullPage: false,
    record: true,
    steps: motion,
  },
];
