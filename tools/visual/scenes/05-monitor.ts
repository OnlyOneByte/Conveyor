import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "monitor",
    route: "/monitor",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
];
