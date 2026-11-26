import { afterAll, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrintNotStartedError, type StageCtx } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker } from "./index";

const tempDir = tempDirs("conveyor-moonraker-files-");
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
afterAll(() => fetchSpy.mockRestore());

test("two jobs to one printer upload and start their own files", async () => {
  const dir = await tempDir();
  const path = join(dir, "model.gcode");
  await writeFile(path, "G28\n");
  const uploaded: string[] = [];
  const starts: string[] = [];
  const answer = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/printer/objects/query?print_stats"))
      return Response.json({ result: { status: { print_stats: { state: "standby" } } } });
    if (String(url).endsWith("/server/files/upload")) {
      const form = await new Response(init?.body, {
        headers: new Headers(init?.headers),
      }).formData();
      for (const [, value] of form) if (typeof value !== "string") uploaded.push(value.name);
    } else starts.push(String(url));
    return new Response("{}", { status: 201 });
  };
  fetchSpy.mockImplementation(Object.assign(answer, { preconnect }));
  const ctx = (jobId: string): StageCtx => ({
    jobId,
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  });
  const target = { id: "p", transportId: "moonraker", address: "10.0.0.9:7125", secrets: {} };
  const first = await moonraker.submit({ path, format: "gcode" }, target, ctx("a1"));
  const second = await moonraker.submit({ path, format: "gcode" }, target, ctx("b2"));
  expect([first.ref, second.ref]).toEqual(["conveyor-a1.gcode", "conveyor-b2.gcode"]);
  expect(uploaded).toEqual(["conveyor-a1.gcode", "conveyor-b2.gcode"]);
  expect(starts).toEqual([
    "http://10.0.0.9:7125/printer/print/start?filename=conveyor-a1.gcode",
    "http://10.0.0.9:7125/printer/print/start?filename=conveyor-b2.gcode",
  ]);
});

test("a start the worker can no longer confirm uploads but never starts the print", async () => {
  const dir = await tempDir();
  const path = join(dir, "model.gcode");
  await writeFile(path, "G28\n");
  const urls: string[] = [];
  const answer = async (url: string | URL | Request) => {
    if (String(url).endsWith("/printer/objects/query?print_stats"))
      return Response.json({ result: { status: { print_stats: { state: "standby" } } } });
    urls.push(String(url));
    return new Response("{}", { status: 201 });
  };
  fetchSpy.mockImplementation(Object.assign(answer, { preconnect }));
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
    confirmStart: async () => {
      throw new PrintNotStartedError("the printer lock was lost");
    },
  };
  const target = { id: "p", transportId: "moonraker", address: "10.0.0.9:7125", secrets: {} };
  await expect(moonraker.submit({ path, format: "gcode" }, target, ctx)).rejects.toBeInstanceOf(
    PrintNotStartedError,
  );
  expect(urls).toEqual(["http://10.0.0.9:7125/server/files/upload"]);
});
