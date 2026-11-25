import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "print-unreachable",
    route: "/",
    ready: "text=How big?",
    fullPage: false,
    steps: [
      { wait: 800 },
      { fulfill: "**/api/jobs", method: "POST", status: 502, json: {} },
      { click: "button.print" },
      { waitFor: "text=Check that it's running, then try again." },
      { click: ".dock summary" },
      { waitFor: ".dock pre >> text=POST /jobs 502" },
      { aligns: ".dock .notice", with: ".dock .bar" },
      { fits: ".dock pre" },
      { wait: 300 },
    ],
  },
  {
    name: "printer-unanswered",
    route: "/",
    ready: "text=How big?",
    fullPage: false,
    steps: [
      { waitFor: ".notice >> text=Elegoo Neptune isn't answering" },
      { scroll: "text=Where should it print?" },
      { aligns: "fieldset:has(.notice) .notice", with: "fieldset:has(.notice)" },
      { fits: "fieldset .notice" },
      { wait: 800 },
    ],
  },
];
