import { describe, expect, test } from "bun:test";
import type { JobStatusEvent } from "./events.js";
import { jobView } from "./job-view.js";

const snapshot: JobStatusEvent = { jobId: "j1", state: "slicing", at: 5 };
const fields = {
  printerId: "voron",
  profileId: "orca/klipper-pla-0.2",
  generator: { id: "gridfinity", params: { gridX: 2 } },
  createdAt: 3,
};

describe("jobView", () => {
  test("merges valid request fields into the snapshot", () => {
    expect(jobView(snapshot, fields)).toEqual({ view: { ...snapshot, ...fields }, complete: true });
  });

  test("keeps only the snapshot when a field is missing, empty or the wrong type", () => {
    for (const bad of [
      undefined,
      { ...fields, printerId: undefined },
      { ...fields, profileId: "" },
      { ...fields, generator: { params: {} } },
      { ...fields, createdAt: -1 },
      { ...fields, createdAt: 1.5 },
    ]) {
      expect(jobView(snapshot, bad)).toEqual({ view: snapshot, complete: false });
    }
  });

  test("does not let request fields overwrite the snapshot's own keys", () => {
    const view = jobView(snapshot, { ...fields, state: "done", jobId: "other" }).view;
    expect([view.jobId, view.state]).toEqual(["j1", "slicing"]);
  });
});
