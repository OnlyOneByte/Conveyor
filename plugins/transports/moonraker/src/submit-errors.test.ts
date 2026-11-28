import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrintNotStartedError, type StageCtx, StageError } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker } from "./index";

const tempDir = tempDirs("conveyor-moonraker-errors-");
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
const target = { id: "p", transportId: "moonraker", address: "10.0.0.9:7125", secrets: {} };

afterAll(() => {
  fetchSpy.mockRestore();
});

function answer(respond: (url: string) => Promise<Response>) {
  const impl = async (url: string | URL | Request) => {
    if (String(url).endsWith("/printer/objects/query?print_stats"))
      return Response.json({ result: { status: { print_stats: { state: "standby" } } } });
    return respond(String(url));
  };
  fetchSpy.mockImplementation(Object.assign(impl, { preconnect }));
}

async function submitWith(controller = new AbortController()) {
  const dir = await tempDir();
  const path = join(dir, "a.gcode");
  await writeFile(path, "G28\n");
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: controller.signal,
    report: () => {},
    log: () => {},
  };
  return moonraker.submit({ path, format: "gcode" }, target, ctx);
}

describe("moonraker submit when the connection fails", () => {
  test("a start the connection drops may have started, and says why", async () => {
    answer(async (url) => {
      if (url.includes("/print/start")) throw new TypeError("socket hang up");
      return new Response("{}", { status: 201 });
    });
    const err = await submitWith().catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "PrintMayHaveStartedError" });
    expect(String(err)).toContain("moonraker start failed: socket hang up");
  });

  test("an upload the connection drops fails the transport stage", async () => {
    answer(async () => {
      throw new TypeError("connection reset");
    });
    const err = await submitWith().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect(err).not.toBeInstanceOf(PrintNotStartedError);
    expect(String(err)).toContain("moonraker upload failed: connection reset");
  });

  test("an upload that fails because the job was canceled never started", async () => {
    const controller = new AbortController();
    answer(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const err = await submitWith(controller).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrintNotStartedError);
    expect(String(err)).toContain("moonraker upload failed: aborted");
  });
});
