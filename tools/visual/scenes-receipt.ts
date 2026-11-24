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
    name: "receipt-outside-bed",
    route: "/jobs",
    ready: "h1",
    steps: [
      {
        fulfill: "**/api/jobs-history/seed-failed",
        status: 200,
        json: {
          id: "seed-failed",
          request: {
            generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
            printerId: "klipper-garage",
            profileId: "prusa/klipper-pla-0.2",
          },
          state: "failed",
          stage: "slicer",
          error: {
            stage: "slicer",
            reason:
              "prusa-slicer exited 0 but wrote no G-code: All objects are outside of the print volume.",
          },
          artifacts: {},
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
      },
      { follow: "/jobs/seed-failed" },
      { waitFor: "text=doesn't fit the printer's bed" },
      { wait: 1200 },
    ],
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
        method: "POST",
        status: 409,
        json: {
          error: "retryOf: job seed-failed is already being retried",
          retriedBy: "seed-printed",
        },
      },
      { click: 'role=button[name="Retry"s]' },
      { waitFor: "text=Configure" },
      { wait: 800 },
      { click: "button.desktop-print:visible, .mobile-cta button:visible" },
      { click: "text=See the retry" },
      { waitFor: "text=Model (STL)" },
      { wait: 1200 },
    ],
  },
  {
    name: "job-switch",
    route: "/",
    ready: "text=Configure",
    steps: [
      {
        fulfill: "**/api/jobs/scene-a",
        status: 200,
        json: { jobId: "scene-a", state: "printing", stage: "transport", progress: 0.42, at: 1 },
      },
      {
        fulfill: "**/api/jobs/scene-b",
        status: 200,
        json: {
          jobId: "scene-b",
          state: "failed",
          error: { stage: "transport", reason: "printer went offline" },
          at: 2,
        },
      },
      { follow: "/?job=scene-a" },
      { waitFor: "text=42%" },
      { follow: "/?job=scene-b" },
      { waitFor: "text=printer went offline" },
      { scroll: "text=printer went offline" },
      { wait: 800 },
    ],
  },
  {
    name: "print-forward",
    route: "/jobs",
    ready: "h1",
    steps: [
      { follow: "/" },
      { waitFor: "text=Configure" },
      { wait: 800 },
      { fulfill: "**/api/jobs", method: "POST", status: 202, json: { jobId: "scene-forward" } },
      {
        fulfill: "**/api/jobs/scene-forward",
        status: 200,
        json: {
          jobId: "scene-forward",
          state: "printing",
          stage: "transport",
          progress: 0.42,
          at: 1,
        },
      },
      { click: "button.desktop-print:visible, .mobile-cta button:visible" },
      { waitFor: "text=42%" },
      { history: "back" },
      { waitFor: "h1 >> text=Jobs" },
      { history: "forward", url: "/jobs/scene-forward" },
      { waitFor: "text=Printing · 42%" },
      { scroll: "text=Printing · 42%" },
      { wait: 800 },
    ],
  },
];
