import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  ...["0", "1", "3", "8", "20", "states"].map((jobs) => ({
    name: `track-${jobs}`,
    route: `/primitives/track?jobs=${jobs}`,
    ready: "h1",
    steps: [{ wait: 600 }],
  })),
  {
    name: "track-stage-words",
    route: "/primitives/track?jobs=8",
    ready: "h1",
    steps: [
      { wait: 600 },
      { absent: ".chip .v:has-text('…')" },
      { waitFor: ".chip:has-text('modelling') >> visible=true" },
    ],
  },
];
