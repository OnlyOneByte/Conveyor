import type { Scene, Step } from "../scene.ts";
import { onChip } from "./10-belt.ts";

const SHELL = "header.top, nav.tabs, #belt";

const touch = (
  name: string,
  route: string,
  ready: string,
  steps: Step[],
  visits?: string[],
): Scene => ({
  name,
  route,
  ready,
  widths: [390],
  touch: true,
  fullPage: false,
  ...(visits ? { visits } : {}),
  steps,
});

export const scenes: Scene[] = [
  touch("touch-home", "/", "text=How big?", [{ wait: 800 }, { targets: SHELL }]),
  touch("touch-receipt-failed", "/jobs/seed-failed", "text=didn't finish", [
    { wait: 800 },
    { targets: `${SHELL}, main` },
    { marker: "main summary" },
  ]),
  touch("touch-receipt-printed", "/jobs/seed-printed", "text=Print again", [
    { wait: 800 },
    { targets: `${SHELL}, main` },
  ]),
  touch("touch-jobs-pills", "/jobs", "[data-id]", [
    { wait: 500 },
    { fits: ".pills .pill:last-child" },
    { targets: ".pills" },
    { click: ".pill >> text=Failed" },
    { waitFor: ".pill[aria-pressed='true'] >> text=Failed" },
    { fits: ".pills .pill:last-child" },
    { wait: 800 },
  ]),
  touch("touch-belt-sheet", "/jobs", "h1", [
    ...onChip,
    { click: "#belt .m .exp" },
    { waitFor: "#belt .m .sheet .row" },
    { click: "#belt .m .needs" },
    { waitFor: "#belt .m .tray .btn" },
    { targets: "#belt" },
  ]),
  touch("touch-track", "/primitives/track", "h1", [{ wait: 1200 }, { targets: "main" }]),
];
