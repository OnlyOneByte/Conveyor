import { describe, expect, test } from "bun:test";
import { rerunRequest } from "./rerun";

const request = { generator: { id: "gridfinity", params: { gridX: 2 } }, printerId: "voron", profileId: "pla" };

describe("whether a job can run again", () => {
  test("a done or canceled job runs again with its own request", () => {
    expect([rerunRequest({ state: "done", request }), rerunRequest({ state: "canceled", request })]).toEqual([request, request]);
  });

  test("a failure, a job still running, an upload, or a job missing its printer or profile can't", () => {
    const upload = { ...request, generator: { id: "passthrough", params: { uploadId: "u1" } } };
    expect([
      rerunRequest({ state: "failed", request }),
      rerunRequest({ state: "printing", request }),
      rerunRequest({ state: "done", request: upload }),
      rerunRequest({ state: "done", request: { ...request, printerId: "" } }),
      rerunRequest({ state: "canceled", request: { ...request, profileId: "" } }),
    ]).toEqual([null, null, null, null, null]);
  });
});
