import type { Scene } from "./scenes.ts";

export const receiptScenes: Scene[] = [
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
    name: "receipt-printed",
    route: "/jobs/seed-printed",
    ready: "text=Print again",
    steps: [{ wait: 1200 }],
  },
  {
    name: "receipt-failed",
    route: "/jobs/seed-failed",
    ready: "text=didn't finish",
    steps: [{ wait: 1200 }],
  },
  {
    name: "receipt-canceled",
    route: "/jobs/seed-canceled",
    ready: "text=Print again",
    steps: [{ wait: 1200 }],
  },
  {
    name: "receipt-missing",
    route: "/jobs/no-such-job",
    ready: "text=We can't find that job",
    steps: [{ wait: 1200 }],
  },
];
