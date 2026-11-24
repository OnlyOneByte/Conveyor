import { describe, expect, test } from "bun:test";
import { ALREADY_RETRIED, AlreadyRetried, linkedRetry, rerunRequest, sendJob } from "./rerun";

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

  test("Make sends a retry through retryJob; a 409 reads in plain words, other refusals pass through", async () => {
    const sent: string[] = [];
    const replying = (status: number, body: object) => Object.assign(async (_: string | URL | Request, init?: RequestInit) => (sent.push(String(init?.body)), Response.json(body, { status })), { preconnect: fetch.preconnect });
    expect(await sendJob(request, "f1", replying(202, { jobId: "j2" }))).toEqual({ jobId: "j2" });
    expect(sent).toEqual([JSON.stringify({ ...request, retryOf: "f1" })]);
    await expect(sendJob(request, "f1", replying(409, { error: "retryOf: job f1 is already being retried" }))).rejects.toThrow(ALREADY_RETRIED);
    await expect(sendJob(request, "f1", replying(400, { error: "unknown printer voron" }))).rejects.toThrow("unknown printer voron");
    expect(ALREADY_RETRIED).toBe("This job was already retried.");
    const taken = { error: "retryOf: job f1 is already being retried", retriedBy: "r1" };
    const refused = await sendJob(request, "f1", replying(409, taken)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AlreadyRetried);
    expect(refused).toMatchObject({ message: ALREADY_RETRIED, retriedBy: "r1" });
    const unnamed = await sendJob(request, "f1", replying(409, { error: "taken" })).catch((e: unknown) => e);
    expect(unnamed).toMatchObject({ message: ALREADY_RETRIED, retriedBy: null });
  });
});
