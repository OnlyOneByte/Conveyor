import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "history",
    route: "/history",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
];
