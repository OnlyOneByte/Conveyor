import type { Scene } from "../scene.ts";

const WHERE = "#make-where";

export const scenes: Scene[] = [
  {
    name: "make-printers-down",
    route: "/",
    ready: "text=How big?",
    steps: [
      { fulfill: "**/api/catalog/printers", method: "GET", status: 500, json: { error: "boom" } },
      { reload: true },
      { waitFor: `${WHERE} [role=alert] >> text=Can't reach Conveyor` },
      { waitFor: `${WHERE} >> text=The printer list didn't load.` },
      { waitFor: `${WHERE} button:has-text('Try again')` },
      { waitFor: "main >> text=Printers didn't load" },
      { absent: "main >> text=Add a printer to print" },
      { absent: `${WHERE} >> text=Add your first printer` },
      { click: `${WHERE} button:has-text('Try again')` },
      { waitFor: `${WHERE} [role=alert] >> text=Can't reach Conveyor` },
    ],
  },
];
