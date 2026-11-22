import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrintNotStartedError, type StageCtx } from "@conveyor/shared";
import { moonraker } from "./index";

const handle = {
  transportId: "moonraker",
  printerId: "p1",
  ref: "a.gcode",
  address: "10.0.0.9:7125",
};

const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");

afterAll(() => {
  fetchSpy.mockRestore();
});

function fakeFetch(respond: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  fetchSpy.mockImplementation(Object.assign(impl, { preconnect }));
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

  test("bounds the stop request with a timeout signal", async () => {
    const calls = fakeFetch(async () => new Response("{}", { status: 200 }));
    await moonraker.cancel?.(handle);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init?.signal?.aborted).toBe(false);
  });

  test("a rejected cancel throws", async () => {
    fakeFetch(async () => new Response("busy", { status: 503 }));
    await expect(moonraker.cancel?.(handle) ?? Promise.resolve()).rejects.toThrow("503");
  });
});

describe("moonraker IPv6 printers", () => {
  test.each([
    ["fe80::1", "http://[fe80::1]:80/printer/print/cancel"],
    ["[fe80::1]:7125", "http://[fe80::1]:7125/printer/print/cancel"],
    ["http://[fe80::1]:7125/", "http://[fe80::1]:7125/printer/print/cancel"],
  ])("%p is reached at %p", async (address, url) => {
    const calls = fakeFetch(async () => new Response("{}", { status: 200 }));
    await moonraker.cancel?.({ ...handle, address });
    expect(calls.map((c) => c.url)).toEqual([url]);
  });

  test("an ambiguous address fails with the parser's reason and sends nothing", async () => {
    const calls = fakeFetch(async () => new Response("{}", { status: 200 }));
    const stop = moonraker.cancel?.({ ...handle, address: "fe80::1::2" }) ?? Promise.resolve();
    await expect(stop).rejects.toThrow('moonraker printer address "fe80::1::2": not a valid IPv6');
    expect(calls).toHaveLength(0);
  });
});

describe("moonraker submit", () => {
  test("a cancel during the upload never starts the print", async () => {
    const dir = await mkdtemp(join(tmpdir(), "conveyor-moonraker-"));
    const path = join(dir, "a.gcode");
    await writeFile(path, "G28\n");
    const controller = new AbortController();
    const calls = fakeFetch(async () => {
      controller.abort();
      return new Response("{}", { status: 201 });
    });
    const ctx: StageCtx = {
      jobId: "j",
      workDir: dir,
      signal: controller.signal,
      report: () => {},
      log: () => {},
    };
    const target = { id: "p", transportId: "moonraker", address: "10.0.0.9:7125", secrets: {} };
    const submit = moonraker.submit({ path, format: "gcode" }, target, ctx);
    await expect(submit).rejects.toBeInstanceOf(PrintNotStartedError);
    expect(calls.map((c) => c.url)).toEqual(["http://10.0.0.9:7125/server/files/upload"]);
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
