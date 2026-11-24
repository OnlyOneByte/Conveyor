import type { Viewport } from "./hits.ts";
import type { Step } from "./scenes.ts";

export const REACH: Viewport[] = [
  [390, 844],
  [390, 667],
  [700, 900],
  [1440, 900],
];

export const toastOnMake: Step[] = [
  { click: "button:has-text('Show a toast')" },
  { click: "nav[aria-label='Main'] a[href='/']" },
  { waitFor: "text=How big?", timeout: 15000 },
  { hover: ".toasts .toast" },
];
