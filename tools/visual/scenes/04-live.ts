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
const OUTCOME = { done: "Printed", failed: "Failed", canceled: "Canceled" };
const READY = { queued: "main .live >> text=Waiting", printing: "main >> text=38 min left" };

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
  finish("finish-phone", "done", [
    { waitFor: "main >> text=12.4 g" },
    { waitFor: "main .live >> text=Took 1 h 13 min" },
    { above: "main .receipt", of: "main .mat" },
  ]),
  finish("fail-phone", "failed", [
    { waitFor: "main .live li.stop >> text=Print" },
    { absent: "main .live li.stop >> text=Send" },
    { waitFor: "main .receipt [role=note] >> text=The print didn't finish" },
    { absent: "main >> text=Sending to the printer didn't finish" },
  ]),
  finish(
    "cancel-queued-phone",
    "canceled",
    [{ absent: "main .live li.stop" }, { absent: "main .live li.past" }],
    { state: "queued", timings: [] },
    { stage: null, timings: [], artifacts: {}, filament: {} },
  ),
];

function finish(
  name: string,
  state: "done" | "failed" | "canceled",
  checks: Step[],
  live: { state: "queued" | "printing"; timings?: object[] } = { state: "printing" },
  entry: object = {},
): Scene {
  const jobId = `scene-${name}`;
  const failure = { error: { stage: "transport", reason: "printer reported an error" } };
  const done = `**/api/jobs/${jobId}`;
  const view = {
    jobId,
    at: ADDED + 60_000,
    timings: [{ stage: "generator", enteredAt: ADDED }],
    ...request,
  };
  return {
    name: `receipt-${name}`,
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
          state,
          stage: "transport",
          ...(state === "failed" ? failure : {}),
          artifacts: {
            model: `/data/jobs/${jobId}/model.stl`,
            gcode: `/data/jobs/${jobId}/model.gcode`,
          },
          filesRemovedAfterDays: 30,
          timings: [
            { stage: "generator", enteredAt: ADDED, durationMs: 2000 },
            { stage: "slicer", enteredAt: ADDED + 2000, durationMs: 41_000 },
            { stage: "transport", enteredAt: ADDED + 43_000, durationMs: 4_326_000 },
          ],
          filament: { grams: 12.4, metres: 4.1 },
          createdAt: ADDED,
          updatedAt: ADDED + 4_369_000,
          ...entry,
        },
      },
      { fulfill: `**/api/jobs-history/${jobId}`, status: 404, json: {}, times: 1 },
      { stall: done, status: 200, json: { ...view, state, progress: state === "done" ? 1 : 0.64 } },
      {
        fulfill: done,
        status: 200,
        json: { ...view, ...(live.state === "printing" ? PRINTING : live) },
        times: 1,
      },
      { follow: `/jobs/${jobId}` },
      { waitFor: READY[live.state] },
      {
        stays: ["main .receipt", "main h2:has-text('Settings')"],
        until: `main .live >> text=${OUTCOME[state]}`,
        releasing: done,
      },
      ...checks,
    ],
  };
}
