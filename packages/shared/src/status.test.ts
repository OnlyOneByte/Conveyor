import { describe, expect, test } from "bun:test";
import { ACTIVE_JOBS_KEY, type JobStatusEvent, jobChannel, jobSnapshotKey } from "./events";
import {
  jobCancelKey,
  jobControlChannel,
  jobSeqKey,
  PUBLISH_STATUS_SCRIPT,
  parseStatusEvent,
  publishStatus,
  type StatusScriptClient,
} from "./status";

function fakeClient(reply: unknown) {
  const calls: { script: string; numKeys: number; args: string[] }[] = [];
  const client: StatusScriptClient = {
    eval: async (script, numKeys, ...args) => {
      calls.push({ script, numKeys, args });
      return reply;
    },
  };
  return { calls, client };
}

describe("publishStatus", () => {
  test("passes the snapshot, channel and active-set keys and the event to the script", async () => {
    const { calls, client } = fakeClient(1);
    const evt: JobStatusEvent = { jobId: "j1", state: "printing", at: 5 };
    expect(await publishStatus(client, evt)).toBe(true);
    expect(calls).toEqual([
      {
        script: PUBLISH_STATUS_SCRIPT,
        numKeys: 4,
        args: [
          jobSnapshotKey("j1"),
          jobChannel("j1"),
          ACTIVE_JOBS_KEY,
          jobSeqKey("j1"),
          JSON.stringify(evt),
          "j1",
          "0",
        ],
      },
    ]);
  });

  test("flags terminal states and reports a refused write", async () => {
    const { calls, client } = fakeClient(0);
    expect(await publishStatus(client, { jobId: "j2", state: "canceled", at: 6 })).toBe(false);
    expect(calls[0].args.at(-1)).toBe("1");
  });

  test("the guard covers every terminal state", () => {
    for (const state of ["done", "failed", "canceled"]) {
      expect(PUBLISH_STATUS_SCRIPT).toContain(`prev.state == '${state}'`);
    }
  });
});

describe("cancel keys", () => {
  test("are scoped to the job", () => {
    expect(jobCancelKey("j1")).toBe("job:j1:cancel");
    expect(jobControlChannel("j1")).toBe("job:j1:control");
    expect(jobSeqKey("j1")).toBe("job:j1:seq");
  });
});

describe("a status event's print fields", () => {
  const event = (print?: unknown) =>
    JSON.stringify({ jobId: "j1", state: "printing", at: 5, progress: 0.5, print });

  test("are kept when valid, and an event without them still parses", () => {
    const print = { layer: 12, layers: 240, secondsLeft: 2460 };
    expect(parseStatusEvent(event(print))?.print).toEqual(print);
    expect(parseStatusEvent(event({ layer: 0 }))?.print).toEqual({ layer: 0 });
    expect(parseStatusEvent(event())).toEqual({
      jobId: "j1",
      state: "printing",
      at: 5,
      progress: 0.5,
    });
  });

  test.each([
    { layer: -1 },
    { layer: 1.5 },
    { layers: 0 },
    { secondsLeft: -1 },
    { secondsLeft: "soon" },
  ])("refuse the whole event when one is out of range: %j", (print) => {
    expect(parseStatusEvent(event(print))).toBeUndefined();
  });
});
