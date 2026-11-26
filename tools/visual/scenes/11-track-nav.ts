import { keys, type Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "track-keys",
    route: "/primitives/track?jobs=8",
    ready: "h1",
    record: true,
    widths: [1440],
    steps: [
      { wait: 600 },
      ...keys("Tab", "Enter", "Tab"),
      { waitFor: "button.grp:focus", timeout: 5000 },
      ...keys("ArrowRight", "ArrowRight"),
      { waitFor: ".card li:nth-child(2) a:focus", timeout: 5000 },
      ...keys("ArrowRight", "ArrowDown"),
      { waitFor: ".card a.btn:focus", timeout: 5000 },
      ...keys("Escape"),
      { waitFor: "a.chip.s-printing:focus", timeout: 5000 },
    ],
  },
  {
    name: "track-keys-narrow",
    route: "/primitives/track?jobs=8",
    ready: "h1",
    widths: [390],
    steps: [
      { wait: 600 },
      ...keys("Tab", "Enter", "Tab"),
      { waitFor: "button.grp:focus", timeout: 5000 },
      ...keys("ArrowRight", "ArrowRight"),
      { waitFor: ".card li:nth-child(2) a:focus", timeout: 5000 },
      ...keys("ArrowRight"),
      { waitFor: ".card li:nth-child(3) a:focus", timeout: 5000 },
      ...keys("Escape"),
      { waitFor: "button.grp:focus", timeout: 5000 },
    ],
  },
  {
    name: "track-card",
    route: "/primitives/track?jobs=3",
    ready: "h1",
    steps: [
      { hover: "a.chip.s-printing" },
      { waitFor: ".card .btn", timeout: 5000 },
      { wait: 300 },
    ],
  },
];
