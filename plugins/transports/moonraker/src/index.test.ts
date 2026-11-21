import { afterEach, describe, expect, test } from "bun:test";
import { moonraker } from "./index";

const realFetch = globalThis.fetch;
const handle = {
  transportId: "moonraker",
  printerId: "p1",
  ref: "a.gcode",
  address: "10.0.0.9:7125",
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeFetch(respond: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  return calls;
}

describe("moonraker cancel", () => {
  test("posts to /printer/print/cancel", async () => {
    const calls = fakeFetch(async () => new Response("{}", { status: 200 }));
    await moonraker.cancel?.(handle);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://10.0.0.9:7125/printer/print/cancel");
    expect(calls[0].init?.method).toBe("POST");
  });

  test("a rejected cancel throws", async () => {
    fakeFetch(async () => new Response("busy", { status: 503 }));
    await expect(moonraker.cancel?.(handle) ?? Promise.resolve()).rejects.toThrow("503");
  });
});

describe("moonraker status", () => {
  test("stops polling when the signal aborts", async () => {
    const calls = fakeFetch(
      async () =>
        new Response(
          JSON.stringify({ result: { status: { print_stats: { state: "printing" } } } }),
        ),
    );
    const controller = new AbortController();
    const seen: string[] = [];
    const run = (async () => {
      for await (const s of moonraker.status(handle, controller.signal)) {
        seen.push(s.state);
        if (s.state === "printing") controller.abort();
      }
    })();
    await expect(run).rejects.toThrow();
    expect(seen).toEqual(["transferring", "printing"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.signal).toBe(controller.signal);
  });
});
