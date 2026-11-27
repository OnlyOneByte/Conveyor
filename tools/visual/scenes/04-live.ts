import type { Scene, Step } from "../scene.ts";

const ADDED = Date.UTC(2026, 0, 1, 12, 31);

const request = {
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  printerId: "elegoo-1",
  profileId: "orca/klipper-pla-0.2",
  createdAt: ADDED,
};

function live(
  name: string,
  ready: string,
  view: object,
  extra: Step[] = [],
  after: Step[] = [],
): Scene {
  const jobId = `scene-${name}`;
  return {
    name: `receipt-${name}`,
    route: "/",
    ready: "text=How big?",
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
      ...extra,
      { follow: `/jobs/${jobId}` },
      { waitFor: ready },
      { wait: 1200 },
      ...after,
    ],
  };
}

const PRINTING = {
  state: "printing",
  progress: 0.64,
  print: { layer: 112, layers: 175, secondsLeft: 2280 },
};

const NARROW = "^(?:\\d{1,2}|1\\d\\d)(?:\\.\\d+)?px$";

const ahead = (jobId: string, createdAt: number) => ({
  jobId,
  state: "queued",
  at: createdAt,
  ...request,
  createdAt,
});

export const scenes: Scene[] = [
  live("queued", "main >> text=2nd", { state: "queued", timings: [] }, [
    {
      fulfill: "**/api/jobs/active",
      status: 200,
      json: [ahead("scene-ahead", ADDED - 60_000), ahead("scene-queued", ADDED)],
    },
  ]),
  live("modelling", "text=Modelling", { state: "generating" }),
  live("slicing", "text=Slicing · 35%", { state: "slicing", progress: 0.35 }),
  live("sending", "text=Sending · 72%", { state: "transferring", progress: 0.72 }),
  live("printing", "text=38 min left", PRINTING),
  {
    ...live(
      "printing-phone",
      "text=38 min left",
      PRINTING,
      [],
      [
        { above: "main .bar", of: "main .mat" },
        { computed: "main button:has-text('Cancel print')", property: "width", matches: NARROW },
      ],
    ),
    widths: [390],
    fullPage: false,
  },
  finish(),
];

function finish(): Scene {
  const jobId = "scene-finish-phone";
  const view = {
    jobId,
    at: ADDED + 60_000,
    timings: [{ stage: "generator", enteredAt: ADDED }],
    ...request,
  };
  return {
    name: "receipt-finish-phone",
    route: "/",
    ready: "text=How big?",
    widths: [390],
    fullPage: false,
    steps: [
      {
        fulfill: `**/api/jobs-history/${jobId}`,
        status: 200,
        json: {
          id: jobId,
          request,
          state: "done",
          stage: "transport",
          createdAt: ADDED,
          updatedAt: ADDED + 120_000,
        },
      },
      { fulfill: `**/api/jobs-history/${jobId}`, status: 404, json: {}, times: 1 },
      {
        fulfill: `**/api/jobs/${jobId}`,
        status: 200,
        json: { ...view, state: "done", progress: 1 },
      },
      { fulfill: `**/api/jobs/${jobId}`, status: 200, json: { ...view, ...PRINTING }, times: 1 },
      { follow: `/jobs/${jobId}` },
      { waitFor: "main .receipt" },
      { stays: "main .receipt", until: "text=Print again" },
      { above: "main .receipt", of: "main .mat" },
    ],
  };
}
