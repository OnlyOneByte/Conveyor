import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  ...["0", "1", "3", "8", "20", "states"].map((jobs) => ({
    name: `track-${jobs}`,
    route: `/primitives/track?jobs=${jobs}`,
    ready: "h1",
    steps: [{ wait: 600 }],
  })),
];
