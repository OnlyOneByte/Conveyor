import type { Scene, Step } from "../scene.ts";

const JOB = "**/api/jobs-history/seed-printed";
const PRINTERS = "**/api/catalog/printers";
const ACTIVE = "**/api/jobs/active";

const loading = (
  name: string,
  from: string,
  to: string,
  glob: string,
  label: string,
  after: string,
  extra: Step[] = [],
): Scene => ({
  name,
  route: from,
  ready: "h1",
  visits: [to],
  fullPage: false,
  steps: [
    { stall: glob, status: 200, json: [] },
    { follow: to },
    { waitFor: `[data-loading='${label}']` },
    { waitFor: "header.top" },
    ...extra,
    { wait: 300 },
    { release: glob },
    { waitFor: after },
    { absent: "[data-loading]" },
  ],
});

export const scenes: Scene[] = [
  loading(
    "loading-make",
    "/settings",
    "/",
    "**/api/generators",
    "Loading Make",
    "h1 >> text=What are we making?",
  ),
  loading(
    "loading-job",
    "/settings",
    "/jobs/seed-printed",
    "**/api/jobs-history/seed-printed",
    "Loading the job",
    "main h1",
  ),
  loading(
    "loading-printers",
    "/settings",
    "/printers",
    "**/api/catalog/printers",
    "Loading printers",
    "main .first",
    [{ absent: "main .acts button.primary[disabled]" }],
  ),
  loading(
    "loading-settings",
    "/jobs",
    "/settings",
    "**/api/catalog/profiles",
    "Loading profiles",
    "text=No profiles yet",
  ),
  {
    name: "loading-job-failed",
    route: "/settings",
    ready: "h1",
    visits: ["/jobs/seed-printed"],
    fullPage: false,
    steps: [
      { stall: JOB, status: 500, json: {} },
      { follow: "/jobs/seed-printed" },
      { waitFor: "[data-loading='Loading the job']" },
      { release: JOB },
      { waitFor: "main h1 >> text=Can't load this job" },
      { absent: "[data-loading]" },
      { stall: JOB, status: 404, json: {} },
      { click: "main button >> text=Try again" },
      { waitFor: "[data-loading='Loading the job']" },
      { release: JOB },
      { waitFor: "main h1:not(#down-title)" },
      { absent: "text=Can't load this job" },
    ],
  },
  {
    name: "loading-printers-add",
    route: "/settings",
    ready: "h1",
    visits: ["/printers"],
    fullPage: false,
    steps: [
      { stall: ACTIVE, status: 200, json: [] },
      { stall: PRINTERS, status: 200, json: [] },
      { follow: "/printers" },
      { waitFor: "[data-loading='Loading printers']" },
      { click: "main .acts button.primary" },
      { waitFor: "main .acts button.primary[aria-busy='true'] >> text=Opening…" },
      { release: PRINTERS },
      { waitFor: "dialog[open]" },
      { absent: "[data-loading]" },
      { release: ACTIVE },
    ],
  },
];
