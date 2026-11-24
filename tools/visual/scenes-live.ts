import type { Scene } from "./scenes.ts";

const ADDED = Date.UTC(2026, 0, 1, 12, 31);

const request = {
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  printerId: "elegoo-1",
  profileId: "orca/klipper-pla-0.2",
  createdAt: ADDED,
};

function live(name: string, ready: string, view: object): Scene {
  const jobId = `scene-${name}`;
  return {
    name: `receipt-${name}`,
    route: "/",
    ready: "text=Configure",
    steps: [
      {
        fulfill: `**/api/jobs/${jobId}`,
        status: 200,
        json: {
          jobId,
          at: ADDED + 60_000,
          timings: [{ stage: "generator", enteredAt: ADDED }],
          ...request,
          ...view,
        },
      },
      { follow: `/jobs/${jobId}` },
      { waitFor: ready },
      { wait: 1200 },
    ],
  };
}

export const liveScenes: Scene[] = [
  live("queued", "text=Waiting", { state: "queued", timings: [] }),
  live("modelling", "text=Modelling", { state: "generating", stage: "generator" }),
  live("slicing", "text=Slicing · 35%", { state: "slicing", stage: "slicer", progress: 0.35 }),
  live("sending", "text=Sending · 72%", {
    state: "transferring",
    stage: "transport",
    progress: 0.72,
  }),
  live("printing", "text=38 min left", {
    state: "printing",
    stage: "transport",
    progress: 0.64,
    print: { layer: 112, layers: 175, secondsLeft: 2280 },
  }),
];
