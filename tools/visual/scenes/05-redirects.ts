import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "monitor",
    route: "/monitor",
    visits: ["/jobs"],
    ready: "h1 >> text=Jobs",
    steps: [{ wait: 800 }],
  },
  {
    name: "history",
    route: "/history",
    visits: ["/jobs"],
    ready: "h1 >> text=Jobs",
    steps: [{ wait: 800 }],
  },
];
