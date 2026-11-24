import type { Scene, Step } from "./scenes.ts";

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

export const beltStateScenes: Scene[] = [
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
