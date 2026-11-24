export type Step =
  | { click: string }
  | { type: string; text: string }
  | { press: string }
  | { scroll: string }
  | { waitFor: string; timeout?: number; warn?: string }
  | { wait: number };

export interface Scene {
  name: string;
  route: string;
  ready: string;
  steps?: Step[];
  record?: boolean;
  fullPage?: boolean;
}

export const WIDTHS = [1440, 390] as const;

export const HEIGHTS: Record<number, number> = { 1440: 900, 390: 844 };

export const scenes: Scene[] = [
  {
    name: "home",
    route: "/",
    ready: "text=Configure",
    steps: [{ wait: 1500 }],
  },
  {
    name: "upload-empty",
    route: "/",
    ready: "text=Configure",
    steps: [{ click: "button:has-text('Upload STL')" }, { wait: 800 }],
  },
  {
    name: "new-job",
    route: "/",
    ready: "text=Configure",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button:has-text('Upload STL')" },
      { wait: 700 },
      { click: "button:has-text('Generate')" },
      { wait: 700 },
      { click: "[role=radiogroup] button >> nth=-1" },
      { wait: 800 },
    ],
  },
  {
    name: "job-progress",
    route: "/",
    ready: "text=Configure",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button.desktop-print:visible, .mobile-cta button:visible" },
      { scroll: "ol.stages, .status" },
      {
        waitFor: "ol.stages li.done:last-child, .status .failed",
        timeout: 12000,
      },
      { wait: 800 },
    ],
  },
  {
    name: "history",
    route: "/history",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
  {
    name: "job-detail",
    route: "/history/seed-canceled",
    ready: ".state",
    steps: [{ wait: 800 }],
  },
  {
    name: "job-detail-failed",
    route: "/history/seed-failed",
    ready: ".state",
    steps: [{ wait: 800 }],
  },
  {
    name: "monitor",
    route: "/monitor",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
  {
    name: "settings",
    route: "/settings",
    ready: "h1",
    steps: [{ wait: 800 }],
  },
];
