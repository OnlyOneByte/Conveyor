import { keys, type Scene } from "../scene.ts";

export const scenes: Scene[] = [
  {
    name: "command-menu",
    route: "/",
    ready: "text=Configure",
    steps: [{ press: "Control+k" }, { waitFor: "dialog[open] >> text=Printers" }, { wait: 300 }],
  },
  ...["done", "2 x 3"].map((text) => ({
    name: `command-menu-${text.replaceAll(" ", "")}`,
    route: "/",
    ready: "text=Configure",
    steps: [
      { press: "Control+k" },
      { type: "dialog[open] input", text },
      { waitFor: "role=option[name=/^Gridfinity Bin 2×3 · 6u , Elegoo Neptune · Printed · /]" },
      { wait: 300 },
    ],
  })),
  {
    name: "shortcut-sheet",
    route: "/",
    ready: "text=Configure",
    steps: [{ wait: 500 }, ...keys("?"), { click: "dialog[open] >> [role=switch]" }, { wait: 300 }],
  },
  {
    name: "keyboard",
    route: "/",
    visits: ["/jobs"],
    ready: "text=Configure",
    record: true,
    steps: [
      { wait: 800 },
      ...keys("Control+k", "j", "o", "b", "s", "Enter"),
      { waitFor: "[data-id]" },
      ...keys("j", "j", "j", "k", "?"),
    ],
  },
];
