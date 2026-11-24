import { describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import { followJob, pillText, printLine, RETRY_MS } from "./job-live.js";

describe("pillText", () => {
  test("adds a percentage only while slicing, sending or printing", () => {
    expect(pillText({ state: "queued" })).toBe("Waiting");
    expect(pillText({ state: "generating", progress: 0.5 })).toBe("Modelling");
    expect(pillText({ state: "slicing", progress: 0.351 })).toBe("Slicing · 35%");
    expect(pillText({ state: "transferring", progress: 0.72 })).toBe("Sending · 72%");
    expect(pillText({ state: "printing" })).toBe("Printing · 0%");
    expect(pillText({ state: "done" })).toBe("Printed");
    expect(pillText({ state: "canceled" })).toBe("Canceled");
  });
});

describe("printLine", () => {
  const clock = (ms: number) => `t+${ms / 60000}m`;

  test("gives the layer, the time left and the finish time, as far as the printer reports", () => {
    const print = { layer: 112, layers: 175, secondsLeft: 2280 };
    expect(printLine(print, 0, clock)).toBe("Layer 112 of 175 · 38 min left · done at t+38m");
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

function watch(snapshot: JobView | null = null) {
  const sockets: FakeSocket[] = [];
  const seen: string[] = [];
  const result = { sockets, seen, ended: 0, stop: () => {} };
  const connect = () => sockets[sockets.push(new FakeSocket()) - 1] ?? new FakeSocket();
  const view = (v: JobView) => seen.push(v.state);
  result.stop = followJob("j", view, () => result.ended++, connect, async () => snapshot);
  return result;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, (RETRY_MS[0] ?? 0) + 100));

describe("followJob", () => {
  test("passes events on, and ends once the job settles or the stream closes for good", () => {
    const live = watch();
    live.sockets[0]?.send("printing");
    live.sockets[0]?.send("done");
    expect([live.seen, live.ended]).toEqual([["printing", "done"], 1]);
    for (const code of [1000, 4404]) {
      const closed = watch();
      closed.sockets[0]?.drop(code);
      expect([closed.sockets.length, closed.ended]).toEqual([1, 1]);
    }
  });

  test("reads the snapshot and reconnects after a drop, until the page lets go", async () => {
    const dropped = watch({ jobId: "j", state: "printing", at: 2 });
    dropped.sockets[0]?.drop(1011);
    await settle();
    expect([dropped.seen, dropped.sockets.length, dropped.ended]).toEqual([["printing"], 2, 0]);
    const finished = watch({ jobId: "j", state: "canceled", at: 2 });
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
