import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "job-detail",
    route: "/history/seed-canceled",
    visits: ["/jobs/seed-canceled"],
    ready: "text=Print again",
    steps: [{ wait: 800 }],
  },
  {
    name: "job-detail-failed",
    route: "/history/seed-failed",
    visits: ["/jobs/seed-failed"],
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
    name: "receipt-files-removed",
    route: "/jobs",
    ready: "h1",
    steps: [
      {
        fulfill: "**/api/jobs-history/seed-printed",
        status: 200,
        json: {
          id: "seed-printed",
          request: {
            generator: {
              id: "gridfinity",
              params: { gridX: 2, gridY: 3, heightUnits: 6, divisionsX: 2, magnetHoles: true },
            },
            printerId: "elegoo-1",
            profileId: "orca/klipper-pla-0.2",
          },
          state: "done",
          stage: "transport",
          artifacts: {
            model: "/data/jobs/seed-printed/model.stl",
            gcode: "/data/jobs/seed-printed/model.gcode",
          },
          filesRemovedAfterDays: 30,
          filament: { grams: 12.4, metres: 4.1 },
          createdAt: 1767225600000,
          updatedAt: 1767225600000,
        },
      },
      { follow: "/jobs/seed-printed" },
      { waitFor: "text=Files removed after 30 days." },
      { wait: 1200 },
    ],
  },
  {
    name: "receipt-failed",
    route: "/jobs/seed-failed",
    ready: "text=didn't finish",
    steps: [
      { waitFor: "section.note p >> text=This job's working files weren't cleaned up." },
      { absent: "section.note details[open]" },
      { click: "section.note summary:has-text('Details')" },
      { waitFor: "section.note pre >> text=work dir not removed: /data/jobs/seed-failed is busy" },
      { wait: 1200 },
    ],
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
    visits: ["/", "/jobs/seed-printed"],
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
      { waitFor: "text=How big?" },
      { wait: 800 },
      { click: "button.print" },
      { click: "text=See the retry" },
      { waitFor: "text=Model (STL)" },
      { wait: 1200 },
    ],
  },
  {
    name: "print-forward",
    route: "/jobs",
    ready: "h1",
    steps: [
      { follow: "/" },
      { waitFor: "text=How big?" },
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
      { click: "button.print" },
      { waitFor: "text=See the job" },
      { history: "back" },
      { waitFor: "h1 >> text=Jobs" },
      { history: "forward", url: "/jobs/scene-forward" },
      { waitFor: "text=Printing · 42%" },
      { scroll: "text=Printing · 42%" },
      { wait: 800 },
    ],
  },
];
