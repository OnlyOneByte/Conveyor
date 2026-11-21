import { describe, expect, test } from "bun:test";
import { ACTIVE_JOBS_KEY, type JobStatusEvent, jobChannel, jobSnapshotKey } from "./events";
import {
  jobCancelKey,
  jobControlChannel,
  PUBLISH_STATUS_SCRIPT,
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
        numKeys: 3,
        args: [
          jobSnapshotKey("j1"),
          jobChannel("j1"),
          ACTIVE_JOBS_KEY,
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
  });
});
