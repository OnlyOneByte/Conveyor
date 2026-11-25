import type { Scene, Step } from "../scene.ts";

const job = (jobId: string, state: string, progress: number, gridX: number) => ({
  jobId,
  state,
  at: Date.UTC(2026, 0, 1, 12, 30),
  progress,
  printerId: "elegoo-1",
  profileId: "orca/klipper-pla-0.2",
  generator: { id: "gridfinity", params: { gridX, gridY: 2, heightUnits: 3 } },
  createdAt: Date.UTC(2026, 0, 1, 12, 30),
});

const LIVE = [
  job("j1", "printing", 0.64, 2),
  job("j2", "slicing", 0.35, 1),
  job("j3", "queued", 0, 3),
];

const active = (json: unknown, status = 200): Step => ({
  fulfill: "**/api/jobs/active",
  status,
  json,
});

const lateFailure = {
  id: "stale-failed",
  request: {
    generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
    printerId: "elegoo-1",
    profileId: "orca/klipper-pla-0.2",
  },
  state: "failed",
  error: { stage: "slicer", reason: "no profile" },
  createdAt: Date.UTC(2026, 0, 1, 12, 0),
  updatedAt: Date.UTC(2026, 0, 1, 12, 1),
};

export const scenes: Scene[] = [
  {
    name: "jobs-today",
    route: "/jobs?day=today",
    ready: "text=Today only",
    steps: [{ waitFor: "h2 >> text=/^Today ·/" }, { wait: 300 }],
  },
  {
    name: "jobs-down-belt",
    route: "/jobs",
    ready: "h1",
    steps: [
      active(LIVE),
      { fulfill: "**/api/jobs-history?*", status: 503, json: { error: "down" } },
      { click: ".pill >> text=Printed" },
      { click: ".pill >> text=All" },
      { waitFor: "[aria-live=assertive] >> text=Can't reach Conveyor" },
      { waitFor: "[data-id='j1']" },
      { waitFor: "#belt .mini i >> visible=true", timeout: 8000 },
      { wait: 300 },
    ],
  },
  {
    name: "jobs-stale",
    route: "/jobs",
    ready: "[data-id]",
    widths: [1440],
    steps: [
      {
        fulfill: "**/api/jobs-history?*state=failed*",
        status: 200,
        json: [lateFailure],
        delayMs: 2500,
      },
      { click: ".pill >> text=Failed" },
      { waitFor: "text=Loading jobs…" },
      { click: ".pill >> text=Printed" },
      { wait: 3500 },
      {
        waitFor:
          'section.jobs:not(:has([data-id="stale-failed"])) .pill[aria-pressed="true"] >> text=Printed',
        timeout: 1000,
      },
    ],
  },
  {
    name: "jobs",
    route: "/jobs",
    ready: "[data-id]",
    steps: [active(LIVE), { waitFor: "text=On the belt · 3", timeout: 8000 }, { wait: 400 }],
  },
  {
    name: "jobs-failed",
    route: "/jobs",
    ready: "[data-id]",
    steps: [
      { click: ".pill >> text=Failed" },
      { waitFor: ".pill[aria-pressed='true'] >> text=Failed" },
      { waitFor: "a.row .note:has-text('Note: status stream did not close cleanly')" },
      { wait: 600 },
    ],
  },
  {
    name: "jobs-empty",
    route: "/jobs",
    ready: "h1",
    steps: [
      active([]),
      { fulfill: "**/api/jobs-history?*", status: 200, json: [] },
      {
        fulfill: "**/api/jobs-history/counts",
        status: 200,
        json: { done: 0, failed: 0, canceled: 0 },
      },
      { click: ".pill >> text=Printed" },
      { click: ".pill >> text=All" },
      { waitFor: "text=No jobs yet" },
      { wait: 300 },
    ],
  },
  {
    name: "jobs-down",
    route: "/jobs",
    ready: "h1",
    steps: [
      active({ error: "down" }, 503),
      { fulfill: "**/api/jobs-history?*", status: 503, json: { error: "down" } },
      { click: ".pill >> text=Printed" },
      { click: ".pill >> text=All" },
      { waitFor: "text=Can't reach Conveyor" },
      { wait: 300 },
    ],
  },
  {
    name: "jobs-keys",
    route: "/jobs",
    visits: ["/jobs/j1"],
    ready: "[data-id]",
    record: true,
    steps: [
      active(LIVE),
      { fulfill: "**/api/jobs/j1", status: 200, json: LIVE[0] },
      { waitFor: "text=On the belt · 3", timeout: 8000 },
      { wait: 500 },
      { press: "j" },
      { wait: 400 },
      { press: "j" },
      { wait: 400 },
      { press: "j" },
      { wait: 400 },
      { press: "k" },
      { wait: 400 },
      { press: "k" },
      { waitFor: "[data-id='j1']:focus" },
      { wait: 400 },
      { press: "Enter" },
      { waitFor: "text=Printing · 64%" },
      { wait: 800 },
    ],
  },
];
