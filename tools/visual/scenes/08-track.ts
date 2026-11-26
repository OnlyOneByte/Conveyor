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
    route: "/primitives/track?jobs=states",
    ready: "h1",
    steps: [
      { wait: 600 },
      { absent: ".chip .v:has-text('…')" },
      { waitFor: "a.chip.s-generating .v >> text=making", timeout: 5000 },
    ],
  },
  {
    name: "track-rail-narrow",
    route: "/primitives/track?jobs=8",
    ready: "h1",
    widths: [390],
    steps: [
      { wait: 600 },
      { absent: ".chip .v:has-text('…')" },
      { waitFor: "a.chip.s-printing >> visible=true", timeout: 5000 },
      { absent: "button.grp:has(.ring ~ .ring ~ .ring)" },
    ],
  },
];
