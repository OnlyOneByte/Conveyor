import { REACH, toastOnMake } from "../reach.ts";
import { keys, type Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "primitives",
    route: "/primitives",
    ready: "text=Primitives",
    steps: [
      { click: "button:has-text('Show a toast')" },
      { hover: "button:has-text('Secondary')" },
      ...keys("Tab", "Tab", "Tab", "Tab", "Tab"),
      { wait: 6500 },
    ],
  },
  {
    name: "toast-reach",
    route: "/primitives",
    visits: ["/"],
    ready: "text=Primitives",
    steps: [
      ...toastOnMake,
      {
        hits: ".toasts button, .dock button, nav[aria-label='Main'] a",
        viewports: REACH,
      },
    ],
  },
  {
    name: "primitives-fields",
    route: "/primitives",
    ready: "text=Fields",
    steps: [{ click: "text=Name" }, { wait: 400 }],
  },
  {
    name: "primitives-dialog",
    route: "/primitives",
    ready: "text=Primitives",
    steps: [
      { click: "button:has-text('Open dialog')" },
      { waitFor: "dialog select:focus", timeout: 5000 },
      ...keys("Tab"),
      { waitFor: "dialog textarea:focus", timeout: 5000 },
      ...keys("Tab", "Tab", "Tab"),
      { waitFor: "dialog select:focus", timeout: 5000 },
      ...keys("Shift+Tab"),
      { waitFor: "dialog button:has-text('Cancel job'):focus", timeout: 5000 },
    ],
  },
  {
    name: "primitives-keys",
    route: "/primitives",
    ready: "text=Primitives",
    record: true,
    steps: [
      { click: "h1" },
      ...keys(
        ...["Tab", "Enter", "Tab", "Escape"],
        ...["Tab", "Enter", "ArrowDown", "ArrowDown", "Escape"],
      ),
    ],
  },
];
