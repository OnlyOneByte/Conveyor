import { REACH, toastOnMake } from "../reach.ts";
import type { Scene } from "../scene.ts";

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

export const scenes: Scene[] = [
  {
    name: "home",
    route: "/",
    ready: "text=How big?",
    steps: [{ wait: 1500 }],
  },
  {
    name: "print-hover",
    route: "/",
    ready: "text=How big?",
    widths: [1440],
    fullPage: false,
    steps: [{ wait: 800 }, { ring: ".dock button.print" }],
  },
  {
    name: "print-tap",
    route: "/",
    ready: "text=How big?",
    widths: [390],
    fullPage: false,
    touch: true,
    steps: [
      { wait: 800 },
      {
        fulfill: "**/api/jobs",
        method: "POST",
        status: 202,
        json: { jobId: "tap-job" },
        delayMs: 30000,
      },
      { noRing: ".dock button.print" },
    ],
  },
  {
    name: "nav-reach",
    route: "/primitives",
    visits: ["/"],
    ready: "text=Primitives",
    steps: [
      ...toastOnMake,
      {
        hits: "nav[aria-label='Main'] a, .dock button, .toasts button",
        viewports: REACH,
      },
    ],
  },
  {
    name: "upload-empty",
    route: "/",
    ready: "text=How big?",
    steps: [uploadTab, { wait: 800 }],
  },
  {
    name: "new-job",
    route: "/",
    ready: "text=How big?",
    record: true,
    steps: [
      { wait: 800 },
      uploadTab,
      { wait: 700 },
      { click: "role=tab[name='Gridfinity Bin']" },
      { wait: 700 },
      { click: "label.pill >> nth=-1" },
      { wait: 800 },
    ],
  },
  {
    name: "job-progress",
    route: "/",
    visits: ["/jobs/job"],
    ready: "text=How big?",
    record: true,
    steps: [
      { wait: 800 },
      { click: "button.print" },
      { click: "text=See the job" },
      { waitFor: "text=Print again", timeout: 15000 },
      { wait: 800 },
    ],
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
      { wait: 300 },
    ],
  },
];
