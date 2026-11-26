import type { Scene } from "../scene.ts";

const resumed = {
  id: "seed-failed",
  request: {
    generator: { id: "gridfinity", params: { gridX: 1, gridY: 1, heightUnits: 3 } },
    printerId: "elegoo-1",
    profileId: "orca/klipper-pla-0.2",
  },
  state: "failed",
  stage: "transport",
  error: { stage: "transport", reason: "resume failed" },
  notes:
    "resume failed: connection lost before completion; work dir not removed: EBUSY /data/jobs/seed-failed",
  createdAt: 1767225600000,
  updatedAt: 1767225600000,
};

export const scenes: Scene[] = [
  {
    name: "auth-timeout",
    route: "/",
    ready: "h1 >> text=Can't reach Conveyor",
    authDown: { status: 200, hang: true },
    widths: [1440],
    steps: [
      { absent: "nav[aria-label='Main']" },
      { click: "summary:has-text('Details')" },
      { waitFor: "text=GET /auth/status timed out after 8000 ms >> visible=true" },
    ],
  },
  {
    name: "receipt-resume-note",
    route: "/jobs",
    ready: "h1",
    steps: [
      { fulfill: "**/api/jobs-history/seed-failed", status: 200, json: resumed },
      { follow: "/jobs/seed-failed" },
      {
        waitFor:
          "section.note p >> text=After a restart, the printer stopped answering before the print finished.",
      },
      { absent: "section.note p:has-text('resume failed')" },
      { click: "section.note summary:has-text('Details')" },
      { waitFor: "section.note pre >> text=resume failed: connection lost before completion" },
      { wait: 600 },
    ],
  },
];
