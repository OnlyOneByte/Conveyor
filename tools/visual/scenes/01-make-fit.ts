import type { Scene } from "../scene.ts";

const WIDE = [
  "solid shelf",
  "facet normal 0 0 1",
  "outer loop",
  "vertex 0 0 0",
  "vertex 240 0 0",
  "vertex 240 90 30",
  "endloop",
  "endfacet",
  "endsolid shelf",
].join("\n");

const uploadTab = { click: "role=tab[name='Upload STL']" };

export const scenes: Scene[] = [
  {
    name: "make-upload-too-big",
    route: "/",
    ready: "text=How big?",
    steps: [
      uploadTab,
      { upload: "input[type=file]", name: "shelf.stl", text: WIDE },
      { waitFor: "section.fit.warn >> text=240 mm wide (the bed takes 220)" },
      { click: "text=Klipper PLA 0.2mm (Prusa)" },
      { waitFor: "section.fit.ok >> text=Fits Elegoo Neptune's 250 × 250 × 250 mm bed." },
      { click: "text=Klipper PLA 0.2mm (Orca)" },
      { waitFor: "section.fit.warn >> text=240 mm wide (the bed takes 220)" },
      { wait: 800 },
    ],
  },
];
