import type { Scene } from "./scenes.ts";

export const receiptScenes: Scene[] = [
  {
    name: "job-detail",
    route: "/history/seed-canceled",
    ready: "text=Print again",
    steps: [{ wait: 800 }],
  },
  {
    name: "job-detail-failed",
    route: "/history/seed-failed",
    ready: "text=didn't finish",
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
  {
    name: "retry-link",
    route: "/jobs/seed-failed",
    ready: "text=didn't finish",
    steps: [
      {
        fulfill: "**/api/jobs",
        status: 409,
        json: {
          error: "retryOf: job seed-failed is already being retried",
          retriedBy: "seed-printed",
        },
      },
      { click: "text=Retry" },
      { waitFor: "text=Configure" },
      { wait: 800 },
      { click: "button.desktop-print:visible, .mobile-cta button:visible" },
      { click: "text=See the retry" },
      { waitFor: "text=Model (STL)" },
      { wait: 1200 },
    ],
  },
];
