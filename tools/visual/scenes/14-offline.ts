import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "offline-nav",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    steps: [
      { offline: "text=How big?" },
      { follow: "/jobs" },
      { waitFor: "h1 >> text=Jobs" },
      { follow: "/settings" },
      { waitFor: "h1 >> text=Settings" },
      { wait: 500 },
    ],
  },
  {
    name: "offline-uncached",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    steps: [
      { offline: "text=How big?", uncache: "/_app/immutable/nodes/" },
      { follow: "/jobs" },
      { waitFor: "h1 >> text=Can't reach Conveyor" },
      { wait: 300 },
    ],
  },
];
