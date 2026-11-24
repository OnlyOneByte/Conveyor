import type { Scene } from "./scenes.ts";

const STL = [
  "solid bin",
  "facet normal 0 0 1",
  "outer loop",
  "vertex 0 0 0",
  "vertex 40 0 0",
  "vertex 0 40 0",
  "endloop",
  "endfacet",
  "endsolid bin",
].join("\n");

const printing = {
  jobId: "scene-print",
  state: "slicing",
  stage: "slicer",
  progress: 0.2,
  at: 1,
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  printerId: "elegoo-1",
  profileId: "orca/klipper-pla-0.2",
  createdAt: 1,
};

const uploadTab = { click: "role=tab[name='Upload STL']" };

export const makeScenes: Scene[] = [
  {
    name: "upload-empty",
    route: "/",
    ready: "text=How big?",
    steps: [uploadTab, { wait: 800 }],
  },
  {
    name: "make-fold",
    route: "/",
    ready: "text=How big?",
    fullPage: false,
    steps: [
      {
        hits: "button.print",
        viewports: [
          [1440, 900],
          [390, 844],
        ],
      },
      { wait: 800 },
    ],
  },
  {
    name: "make-upload-bad",
    route: "/",
    ready: "text=How big?",
    steps: [
      uploadTab,
      { upload: "input[type=file]", name: "notes.txt", text: "not a model" },
      { waitFor: "[role=alert] >> text=isn't an STL file" },
      { wait: 500 },
    ],
  },
  {
    name: "make-upload-good",
    route: "/",
    ready: "text=How big?",
    steps: [
      uploadTab,
      { upload: "input[type=file]", name: "bin.stl", text: STL },
      { waitFor: "text=Ready to print" },
      { wait: 1200 },
    ],
  },
  {
    name: "make-print",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    fullPage: false,
    record: true,
    steps: [
      { wait: 800 },
      { fulfill: "**/api/jobs", method: "POST", status: 202, json: { jobId: printing.jobId } },
      { fulfill: "**/api/jobs/scene-print", status: 200, json: printing },
      { fulfill: "**/api/jobs/active", status: 200, json: [printing] },
      { click: "button.print" },
      { waitFor: "button.print >> text=Sent ✓" },
      { waitFor: "#belt .chips a.chip", timeout: 8000 },
      { wait: 1500 },
    ],
  },
];
