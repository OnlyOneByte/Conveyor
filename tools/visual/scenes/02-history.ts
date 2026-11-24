import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "history",
    route: "/history",
    ready: "tbody tr a.jobid",
    steps: [{ wait: 800 }],
  },
];
