import type { Scene, Step } from "../scene.ts";

const WORD = "GarageDrawer".repeat(7).slice(0, 80);

const printer = (i: number, name: string) => ({
  id: i === 0 ? "elegoo-1" : `printer-${i}`,
  transportId: i % 2 ? "moonraker" : "elegoo",
  name,
  address: "127.0.0.1",
  hasSecrets: false,
});

const stub = (names: string[]): Step => ({
  fulfill: "**/api/catalog/printers",
  method: "GET",
  status: 200,
  json: names.map((name, i) => printer(i, name)),
});

const twelve = Array.from({ length: 12 }, (_, i) => (i ? `Printer ${i}` : "Elegoo Neptune"));

const make = (
  name: string,
  printers: string[],
  steps: Step[],
  only?: { touch?: boolean; widths: readonly (390 | 1440)[] },
): Scene => ({
  name,
  route: "/settings",
  ready: "h1",
  visits: ["/"],
  fullPage: false,
  ...(only ?? {}),
  steps: [stub(printers), { follow: "/" }, { waitFor: "text=How big?" }, ...steps, { wait: 300 }],
});

export const scenes: Scene[] = [
  make(
    "print-at-many",
    twelve,
    [
      { waitFor: "#make-where .pills.many" },
      { computed: "#make-where .pills.many", property: "overflow-y", matches: "^auto$" },
      { above: "#make-where fieldset:nth-of-type(2) legend", of: ".dock" },
    ],
    { widths: [1440] },
  ),
  make(
    "print-at-many-narrow",
    twelve,
    [{ waitFor: "#make-where .pills.many" }, { fits: "#make-where" }],
    {
      widths: [390],
    },
  ),
  make("print-at-few", twelve.slice(0, 3), [
    { waitFor: "#make-where .pills" },
    { absent: "#make-where .pills.many" },
  ]),
  make(
    "print-at-word",
    [WORD, "Printer 1"],
    [
      { waitFor: `#make-where .pill >> text=${WORD.slice(0, 24)}` },
      { fits: "#make-where" },
      { lines: "#make-where .pill b", max: 1 },
      { computed: "#make-where .pill b", property: "text-overflow", matches: "^ellipsis$" },
    ],
  ),
  make("touch-steppers", ["Elegoo Neptune"], [{ targets: ".stepper" }], {
    touch: true,
    widths: [390],
  }),
];
