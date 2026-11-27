import { afterEach, expect, spyOn, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrinterTarget, PrintStatus, StageCtx } from "@conveyor/shared";
import { stubPrinterDns, tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker as plugin } from "./index.ts";

const LAN = ["192.168.1.40"];
const METADATA = ["169.254.169.254"];
const AT = "http://192.168.1.40:7125/";
const tempDir = tempDirs("conveyor-moonraker-pin-");
const { preconnect } = globalThis.fetch;
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

const json = (body: unknown) => Response.json(body);
const stats = (state: string) => json({ result: { status: { print_stats: { state } } } });

function printer(answer: (path: string) => Response) {
  const seen: { url: string; host: string | null }[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, host: new Headers(init?.headers).get("host") });
        return answer(new URL(url).pathname);
      },
      { preconnect },
    ),
  );
  restores.push(() => spy.mockRestore());
  return seen;
}

function dns() {
  const stub = stubPrinterDns(LAN, METADATA);
  restores.push(stub.restore);
  return stub.asked;
}

const target: PrinterTarget = {
  id: "p1",
  transportId: "moonraker",
  address: "printer.example:7125",
  secrets: {},
};

const pinnedOnly = (seen: { url: string; host: string | null }[]) => {
  expect(seen.length).toBeGreaterThan(0);
  for (const request of seen) {
    expect(request.url.startsWith(AT)).toBe(true);
    expect(request.host).toBe("printer.example:7125");
  }
};

test("a submit's readiness check, upload and print start all go to the checked IP", async () => {
  const asked = dns();
  const seen = printer((path) =>
    path === "/printer/objects/query" ? stats("standby") : json({ result: "ok" }),
  );
  const dir = await tempDir();
  const path = join(dir, "a.gcode");
  await writeFile(path, "G28\n");
  const ctx: StageCtx = {
    jobId: "pin",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  await plugin.submit({ path, format: "gcode" }, target, ctx);
  expect(asked).toEqual(["printer.example"]);
  expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
    "/printer/objects/query",
    "/server/files/upload",
    "/printer/print/start",
  ]);
  pinnedOnly(seen);
});

test("a status poll goes to the IP checked for that poll", async () => {
  dns();
  const seen = printer(() => stats("complete"));
  const handle = {
    transportId: "moonraker",
    printerId: "p1",
    ref: "a.gcode",
    address: target.address,
  };
  const states: PrintStatus["state"][] = [];
  for await (const status of plugin.status(handle, undefined, target)) states.push(status.state);
  expect(states).toEqual(["transferring", "done"]);
  pinnedOnly(seen);
});

test("pruning lists and checks the printer at the checked IP", async () => {
  dns();
  const seen = printer((path) =>
    path === "/server/files/list" ? json({ result: [] }) : stats("standby"),
  );
  await plugin.pruneFiles?.(target, new Set(), new AbortController().signal);
  pinnedOnly(seen);
});
