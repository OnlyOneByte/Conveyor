import type { Scene } from "../scene.ts";
import { errorCard } from "./02-jobs.ts";

const card = "main .state.err[role=alert]";

export const scenes: Scene[] = [
  {
    name: "printers-down",
    route: "/settings",
    ready: "h1",
    visits: ["/printers"],
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 500, json: {} },
      { follow: "/printers" },
      { waitFor: `${card} h2 >> text=Can't reach Conveyor` },
      ...errorCard(card),
      { absent: "main .acts >> text=Add printer" },
      { wait: 400 },
    ],
  },
  {
    name: "printers-down-retry",
    route: "/settings",
    ready: "h1",
    visits: ["/printers"],
    widths: [390],
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 500, json: {}, times: 2 },
      { follow: "/printers" },
      { waitFor: `${card} >> text=Can't reach Conveyor` },
      { click: `${card} button >> text=Try again` },
      { waitFor: "main ul[aria-label=Printers] li" },
      { absent: "main .state" },
      { waitFor: "main .acts button.primary >> text=Add printer" },
    ],
  },
];
