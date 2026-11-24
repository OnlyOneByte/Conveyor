import { describe, expect, test } from "bun:test";
import { retryJob } from "./retry";

const failed = { id: "f1", request: { generator: { id: "gridfinity", params: { gridX: 2 } }, printerId: "voron", profileId: "pla" } };
const answering = (status: number, body: string) => {
  const sent: [string, RequestInit | undefined][] = [];
  const fetchFn = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push([String(url), init]);
    return new Response(body, { status });
  }, { preconnect: fetch.preconnect });
  return { sent, fetchFn };
};

describe("retrying a failed job", () => {
  test("posts the failed request with retryOf and returns the new job", async () => {
    const { sent, fetchFn } = answering(202, JSON.stringify({ jobId: "j2" }));
    expect(await retryJob(failed, fetchFn)).toEqual({ ok: true, jobId: "j2" });
    expect(sent.map(([url, init]) => [url, init?.method, init?.body])).toEqual([["/api/jobs", "POST", JSON.stringify({ ...failed.request, retryOf: "f1" })]]);
  });

  test("a 409, an unreadable error and an answer without a job id come back as refusals", async () => {
    const taken = answering(409, JSON.stringify({ error: "retryOf: job f1 is already being retried" }));
    const broken = answering(500, "<html>");
    const blank = answering(202, "{}");
    expect([await retryJob(failed, taken.fetchFn), await retryJob(failed, broken.fetchFn), await retryJob(failed, blank.fetchFn)]).toEqual([
      { ok: false, status: 409, error: "retryOf: job f1 is already being retried" },
      { ok: false, status: 500, error: "POST /jobs 500" },
      { ok: false, status: 202, error: "POST /jobs 202" },
    ]);
  });
});
