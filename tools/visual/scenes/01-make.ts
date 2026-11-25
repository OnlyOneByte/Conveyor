import { REACH, toastOnMake } from "../reach.ts";
import type { Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "home",
    route: "/",
    ready: "text=Configure",
    steps: [{ wait: 1500 }],
  },
  {
    name: "print-hover",
    route: "/",
    ready: "text=Configure",
    widths: [1440],
    fullPage: false,
    steps: [{ wait: 800 }, { ring: "button.desktop-print" }],
  },
  {
    name: "nav-reach",
    route: "/primitives",
    visits: ["/"],
    ready: "text=Primitives",
    steps: [
      ...toastOnMake,
      {
        hits: "nav[aria-label='Main'] a, .mobile-cta button, .toasts button",
        viewports: REACH,
      },
    ],
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
];
