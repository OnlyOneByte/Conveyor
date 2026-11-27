import type { Scene, Step } from "../scene.ts";

const HOLD =
  "Elegoo Neptune is on hold. Check it, then choose Release hold on the Printers page before you print to it.";
const refuse: Step = {
  fulfill: "**/api/jobs",
  method: "POST",
  status: 409,
  json: { error: HOLD, held: true },
};
const refused: Step[] = [
  { waitFor: "text=How big?" },
  { wait: 800 },
  { click: "button.print" },
  { waitFor: ".dock [role=alert] >> text=Your print didn't go out" },
  { waitFor: ".dock >> text=Elegoo Neptune is on hold." },
  { absent: ".dock >> text=See the retry" },
  { absent: ".dock >> text=See the job" },
];

export const scenes: Scene[] = [
  {
    name: "held-stale-print-again",
    route: "/jobs/seed-printed",
    visits: ["/"],
    ready: "text=Print again",
    steps: [refuse, { click: 'role=button[name="Print again"s]' }, ...refused],
  },
  {
    name: "held-stale-retry",
    route: "/jobs/seed-failed",
    visits: ["/"],
    ready: "text=didn't finish",
    steps: [refuse, { click: 'role=button[name="Retry"s]' }, ...refused],
  },
  {
    name: "held-jobs-r-key",
    route: "/jobs",
    ready: "[data-id]",
    widths: [1440],
    steps: [
      refuse,
      { wait: 1500 },
      { click: ".pill >> text=Failed" },
      { waitFor: "a.row.s-failed" },
      { click: "h1" },
      { press: "j" },
      { waitFor: "a.row.s-failed:focus" },
      { press: "r" },
      { waitFor: "[aria-live=assertive] >> text=Elegoo Neptune is on hold." },
      { absent: "[aria-live] >> text=already being retried" },
    ],
  },
  {
    name: "held-belt-retry",
    route: "/jobs",
    ready: "h1",
    widths: [390],
    fullPage: false,
    steps: [
      refuse,
      { click: "#belt .m .exp" },
      { click: "#belt .m .needs" },
      { click: "#belt .m .tray .btn >> text=Retry" },
      { waitFor: "[aria-live=assertive] >> text=Elegoo Neptune is on hold." },
      { absent: "[aria-live] >> text=already being retried" },
    ],
  },
];
