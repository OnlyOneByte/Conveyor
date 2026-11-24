import { describe, expect, test } from "bun:test";
import { linkedRetry, rerunRequest, submitError } from "./rerun";

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

  test("Make keeps a failure's retryOf only while it generates with the stashed generator", () => {
    const handoff = { generatorId: "gridfinity", printerId: "", profileId: "", retryOf: "f1" };
    expect([
      linkedRetry(handoff, "generate", "gridfinity"),
      linkedRetry(handoff, "upload", "gridfinity"),
      linkedRetry(handoff, "generate", "baseplate"),
      linkedRetry({ ...handoff, retryOf: undefined }, "generate", "gridfinity"),
      linkedRetry(null, "generate", "gridfinity"),
    ]).toEqual(["f1", undefined, undefined, undefined, undefined]);
  });

  test("a 409 for a failure already retried reads in plain words; other errors pass through", () => {
    expect([submitError("retryOf: job f1 is already being retried"), submitError("unknown printer p")]).toEqual(["This failure was already retried.", "unknown printer p"]);
  });
});
