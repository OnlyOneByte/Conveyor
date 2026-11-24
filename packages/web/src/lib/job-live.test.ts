import { describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import { followJob, ordinal, pillText, placeInLine, printLine, RETRY_MS } from "./job-live.js";

const job = (jobId: string, extra: Partial<JobView>): JobView => ({
  jobId,
  state: "queued",
  at: 0,
  printerId: "voron",
  ...extra,
});

describe("pillText", () => {
  test("names a waiting or modelling job without a percentage", () => {
    expect(pillText({ state: "queued" })).toBe("Waiting");
    expect(pillText({ state: "generating", progress: 0.5 })).toBe("Modelling");
  });

  test("adds the percentage while slicing, sending or printing", () => {
    expect(pillText({ state: "slicing", progress: 0.351 })).toBe("Slicing · 35%");
    expect(pillText({ state: "transferring", progress: 0.72 })).toBe("Sending · 72%");
    expect(pillText({ state: "printing" })).toBe("Printing · 0%");
  });

  test("uses the receipt's words once the job settles", () => {
    expect(pillText({ state: "done" })).toBe("Printed");
    expect(pillText({ state: "canceled" })).toBe("Canceled");
  });
});

describe("printLine", () => {
  const clock = (ms: number) => `t+${ms / 60000}m`;

  test("gives the layer, the time left and the finish time", () => {
    const print = { layer: 112, layers: 175, secondsLeft: 2280 };
    expect(printLine(print, 0, clock)).toBe("Layer 112 of 175 · 38 min left · done at t+38m");
  });

  test("leaves out whatever the printer doesn't report", () => {
    expect(printLine({ secondsLeft: 600 }, 0, clock)).toBe("10 min left · done at t+10m");
    expect(printLine({ layer: 3 }, 0, clock)).toBe("");
    expect(printLine(undefined, 0, clock)).toBe("");
  });
});

class FakeSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  send(state: string) {
    this.onmessage?.(new MessageEvent("message", { data: `{"jobId":"j","state":"${state}"}` }));
  }
  drop(code: number) {
    this.onclose?.(new CloseEvent("close", { code }));
  }
}

function watch(...snapshots: (JobView | null)[]) {
  const sockets: FakeSocket[] = [];
  const seen: string[] = [];
  const result = { sockets, seen, ended: 0, reads: 0, stop: () => {} };
  const connect = () => sockets[sockets.push(new FakeSocket()) - 1] ?? new FakeSocket();
  const view = (v: JobView) => seen.push(v.state);
  const read = async () => snapshots[Math.min(result.reads++, snapshots.length - 1)] ?? null;
  result.stop = followJob("j", view, () => result.ended++, connect, read);
  return result;
}

const snap = (state: JobView["state"]): JobView => ({ jobId: "j", state, at: 2 });

const settle = () => new Promise((resolve) => setTimeout(resolve, (RETRY_MS[0] ?? 0) + 100));

describe("followJob", () => {
  test("passes events on, and reloads once the job settles", () => {
    const live = watch();
    live.sockets[0]?.send("printing");
    live.sockets[0]?.send("done");
    expect([live.seen, live.ended]).toEqual([["printing", "done"], 1]);
  });

  test("reloads when the stream closes for good and the job is gone or settled", async () => {
    for (const [code, last] of [[1000, snap("done")], [4404, null]] as const) {
      const closed = watch(last);
      closed.sockets[0]?.drop(code);
      await settle();
      expect([closed.sockets.length, closed.ended]).toEqual([1, 1]);
    }
  });

  test("polls the snapshot while a refused stream's job still reads running", async () => {
    const refused = watch(snap("printing"), snap("printing"), snap("done"));
    refused.sockets[0]?.drop(4404);
    await settle();
    expect(refused.ended).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, (RETRY_MS[0] ?? 0) + (RETRY_MS[1] ?? 0) + 200));
    expect([refused.seen, refused.sockets.length, refused.ended]).toEqual([
      ["printing", "printing", "done"],
      1,
      1,
    ]);
  });

  test("reads the snapshot and reconnects after a dropped stream", async () => {
    const dropped = watch(snap("printing"));
    dropped.sockets[0]?.drop(1011);
    await settle();
    expect([dropped.seen, dropped.sockets.length, dropped.ended]).toEqual([["printing"], 2, 0]);
    const finished = watch(snap("canceled"));
    finished.sockets[0]?.drop(1013);
    await settle();
    expect([finished.sockets.length, finished.ended]).toEqual([1, 1]);
    const left = watch();
    left.stop();
    left.sockets[0]?.drop(1011);
    await settle();
    expect([left.sockets.length, left.sockets[0]?.closed]).toEqual([1, true]);
  });
});

describe("placeInLine", () => {
  const active = [
    job("printing", { state: "printing", createdAt: 1 }),
    job("late", { createdAt: 30 }),
    job("early", { createdAt: 10 }),
    job("other-printer", { createdAt: 5, printerId: "ender" }),
    job("tie-b", { createdAt: 20 }),
    job("tie-a", { createdAt: 20 }),
  ];

  test("counts only waiting jobs for the same printer, oldest first", () => {
    expect(placeInLine("early", active)).toBe(1);
    expect(placeInLine("tie-a", active)).toBe(2);
    expect(placeInLine("tie-b", active)).toBe(3);
    expect(placeInLine("late", active)).toBe(4);
    expect(placeInLine("other-printer", active)).toBe(1);
  });

  test("has no place for a running, missing or printerless job", () => {
    expect(placeInLine("printing", active)).toBeNull();
    expect(placeInLine("gone", active)).toBeNull();
    expect(placeInLine("loose", [job("loose", { printerId: undefined })])).toBeNull();
  });
});

describe("ordinal", () => {
  test("writes English ordinals, teens included", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th",
    ]);
  });
});
