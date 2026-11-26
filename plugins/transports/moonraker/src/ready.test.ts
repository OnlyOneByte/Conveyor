import { afterAll, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PrinterReadiness,
  PrintNotStartedError,
  refuseUnlessIdle,
  type StageCtx,
} from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker } from "./index";
import { moonrakerReadiness, readinessOf } from "./ready";

const tempDir = tempDirs("conveyor-moonraker-ready-");
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
afterAll(() => fetchSpy.mockRestore());

const BASE = "http://10.0.0.9:7125";
const stateReply = (state: string) =>
  Response.json({ result: { status: { print_stats: { state } } } });

function printer(answer: (url: string, signal?: AbortSignal) => Promise<Response>) {
  const urls: string[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    return answer(String(url), init?.signal ?? undefined);
  };
  fetchSpy.mockImplementation(Object.assign(impl, { preconnect }));
  return urls;
}

test.each<[string | undefined, PrinterReadiness]>([
  ["standby", "idle"],
  ["complete", "idle"],
  ["cancelled", "idle"],
  ["printing", "printing"],
  ["paused", "paused"],
  ["error", "error"],
  ["startup", "unknown"],
  [undefined, "unknown"],
])("print_stats.state %s reads as %s", (state, readiness) => {
  expect(readinessOf(state)).toBe(readiness);
});

test("asks only print_stats, and reads the printer's state from it", async () => {
  const urls = printer(async () => stateReply("printing"));
  expect(await moonrakerReadiness(BASE, {}, 1000)).toBe("printing");
  expect(urls).toEqual([`${BASE}/printer/objects/query?print_stats`]);
});

test.each([
  ["refuses the connection", () => Promise.reject(new TypeError("Unable to connect"))],
  ["answers 503", async () => new Response("down", { status: 503 })],
  ["answers with junk", async () => new Response("not json")],
  [
    "never answers",
    (_url: string, signal?: AbortSignal) =>
      new Promise<Response>((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  ],
])("a printer that %s fails closed as not started", async (_name, answer) => {
  printer(answer);
  const check = moonrakerReadiness(BASE, {}, 30);
  await expect(check).rejects.toBeInstanceOf(PrintNotStartedError);
  await expect(check).rejects.toThrow("moonraker idle check failed");
});

test.each([
  ["printing", "printer is busy: moonraker reports it printing"],
  ["paused", "printer is busy: moonraker reports it paused"],
  ["error", "printer reports an error: moonraker says error"],
  ["unknown", "printer state unknown: moonraker gave no usable state"],
] as const)("a printer that is %s is refused as not started", (state, reason) => {
  expect(() => refuseUnlessIdle("moonraker", state)).toThrow(PrintNotStartedError);
  expect(() => refuseUnlessIdle("moonraker", state)).toThrow(reason);
  expect(() => refuseUnlessIdle("moonraker", "idle")).not.toThrow();
});

test.each(["printing", "paused", "error"])(
  "submit to a printer that is %s uploads nothing and starts nothing",
  async (state) => {
    const dir = await tempDir();
    const path = join(dir, "model.gcode");
    await writeFile(path, "G28\n");
    const urls = printer(async () => stateReply(state));
    const ctx: StageCtx = {
      jobId: "j",
      workDir: dir,
      signal: new AbortController().signal,
      report: () => {},
      log: () => {},
    };
    const target = { id: "p", transportId: "moonraker", address: "10.0.0.9:7125", secrets: {} };
    const submit = moonraker.submit({ path, format: "gcode" }, target, ctx);
    await expect(submit).rejects.toBeInstanceOf(PrintNotStartedError);
    expect(urls).toEqual([`${BASE}/printer/objects/query?print_stats`]);
  },
);
