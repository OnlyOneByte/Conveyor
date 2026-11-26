import type { Scene, Step } from "../scene.ts";

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
    "**/api/catalog/generators",
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
];
