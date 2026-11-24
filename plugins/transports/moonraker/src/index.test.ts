import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrintNotStartedError, type StageCtx, StageError } from "@conveyor/shared";
import { moonraker } from "./index";

const handle = {
  transportId: "moonraker",
  printerId: "p1",
  ref: "a.gcode",
  address: "10.0.0.9:7125",
};

const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms),
    ),
  ]);

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

describe("moonraker submit, the printer answers", () => {
  async function gcodeCtx() {
    const dir = await mkdtemp(join(tmpdir(), "conveyor-moonraker-"));
    const path = join(dir, "bin 1.gcode");
    await writeFile(path, "G28\n");
    const ctx: StageCtx = {
      jobId: "j",
      workDir: dir,
      signal: new AbortController().signal,
      report: () => {},
      log: () => {},
    };
    return { path, ctx };
  }
  const target = { id: "p", transportId: "moonraker", address: "10.0.0.9:7125", secrets: {} };

  test("reports the g-code bytes sent of the total as the printer reads the upload", async () => {
    const { path, ctx } = await gcodeCtx();
    const sent: number[][] = [];
    fakeFetch(async (url, init) => {
      if (url.endsWith("/server/files/upload")) await new Response(init?.body).arrayBuffer();
      return new Response("{}", { status: 201 });
    });
    await moonraker.submit({ path, format: "gcode" }, target, {
      ...ctx,
      reportUpload: (bytesSent, bytesTotal) => void sent.push([bytesSent, bytesTotal]),
    });
    expect(sent).toEqual([[4, 4]]);
  });

  test("uploads the file, starts it and returns a handle naming it", async () => {
    const { path, ctx } = await gcodeCtx();
    const calls = fakeFetch(async () => new Response("{}", { status: 201 }));
    expect(await moonraker.submit({ path, format: "gcode" }, target, ctx)).toEqual({
      transportId: "moonraker",
      printerId: "p",
      ref: "bin 1.gcode",
      address: "10.0.0.9:7125",
    });
    expect(calls.map((c) => c.url)).toEqual([
      "http://10.0.0.9:7125/server/files/upload",
      "http://10.0.0.9:7125/printer/print/start?filename=bin%201.gcode",
    ]);
  });

  test("streams the g-code as the multipart file part and keeps the API key header", async () => {
    const { path, ctx } = await gcodeCtx();
    const parts: { field: string; name: string; text: string; key: string | null }[] = [];
    fakeFetch(async (url, init) => {
      if (url.endsWith("/server/files/upload")) {
        const headers = new Headers(init?.headers);
        const form = await new Response(init?.body, { headers }).formData();
        for (const [field, value] of form) {
          if (typeof value === "string") continue;
          parts.push({
            field,
            name: value.name,
            text: await value.text(),
            key: headers.get("x-api-key"),
          });
        }
      }
      return new Response("{}", { status: 201 });
    });
    const keyed = { ...target, secrets: { apiKey: "k1" } };
    await moonraker.submit({ path, format: "gcode" }, keyed, ctx);
    expect(parts).toEqual([{ field: "file", name: "bin 1.gcode", text: "G28\n", key: "k1" }]);
  });

  test("an upload the printer never answers times out as a transport failure, not a cancel", async () => {
    const { path, ctx } = await gcodeCtx();
    const calls = fakeFetch(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          }),
        ),
    );
    const before = process.env.CONVEYOR_UPLOAD_TIMEOUT_MS;
    process.env.CONVEYOR_UPLOAD_TIMEOUT_MS = "30";
    try {
      const submit = within(moonraker.submit({ path, format: "gcode" }, target, ctx), 2000);
      await expect(submit).rejects.toBeInstanceOf(StageError);
      await expect(submit).rejects.toThrow("moonraker upload failed");
      expect(calls).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.CONVEYOR_UPLOAD_TIMEOUT_MS;
      else process.env.CONVEYOR_UPLOAD_TIMEOUT_MS = before;
    }
  });

  test("a rejected upload fails the transport stage and starts nothing", async () => {
    const { path, ctx } = await gcodeCtx();
    const calls = fakeFetch(async () => new Response("no", { status: 507 }));
    await expect(moonraker.submit({ path, format: "gcode" }, target, ctx)).rejects.toThrow(
      "moonraker upload failed: 507",
    );
    expect(calls).toHaveLength(1);
  });

  test("a rejected start fails the transport stage", async () => {
    const { path, ctx } = await gcodeCtx();
    fakeFetch(
      async (url) => new Response("{}", { status: url.includes("/print/start") ? 409 : 201 }),
    );
    await expect(moonraker.submit({ path, format: "gcode" }, target, ctx)).rejects.toThrow(
      "moonraker start failed: 409",
    );
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
