import type { Scene } from "../scene.ts";

const ADD = "main .acts button.primary";

export const scenes: Scene[] = [
  {
    name: "motion-dialog",
    route: "/printers",
    ready: "h1",
    widths: [1440],
    fullPage: false,
    steps: [
      { computed: ADD, property: "transition-property", matches: "scale" },
      { click: ADD },
      { waitFor: "dialog[open] :focus" },
      { computed: "dialog[open]", property: "transition-duration", matches: "^0\\.15s" },
      { wait: 400 },
    ],
  },
  {
    name: "motion-dialog-reduced",
    route: "/printers",
    ready: "h1",
    widths: [1440],
    fullPage: false,
    reducedMotion: true,
    steps: [
      { click: ADD },
      { waitFor: "dialog[open]" },
      {
        computed: "dialog[open]",
        property: "transition-duration",
        matches: "^(0s|1e-06s)(, (0s|1e-06s))*$",
      },
      { computed: "dialog[open]", property: "opacity", matches: "^1$" },
    ],
  },
  {
    name: "dock-depth",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    fullPage: false,
    steps: [
      { waitFor: ".dock .bar" },
      { computed: ".dock .bar", property: "--dock-bg", matches: "^oklch\\((22|29)% " },
    ],
  },
  {
    name: "motion-sheet-reduced",
    route: "/",
    ready: "text=How big?",
    widths: [390],
    fullPage: false,
    reducedMotion: true,
    steps: [
      { click: "button.exp" },
      { waitFor: ".sheet" },
      { click: "button.exp" },
      { absent: ".sheet" },
    ],
  },
];
