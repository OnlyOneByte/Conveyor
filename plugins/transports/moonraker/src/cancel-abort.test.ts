import { afterEach, expect, spyOn, test } from "bun:test";
import type { PrintHandle } from "@conveyor/shared";
import { holdPrinterDns, stubPrinterDns } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker as plugin } from "./index.ts";

const { preconnect } = globalThis.fetch;
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

const handle: PrintHandle = {
  transportId: "moonraker",
  printerId: "p1",
  ref: "a.gcode",
  address: "printer.example:7125",
};

function requests(answer: (signal: AbortSignal) => Promise<Response>) {
  const seen: string[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        seen.push(String(input));
        return answer(init?.signal ?? new AbortController().signal);
      },
      { preconnect },
    ),
  );
  restores.push(() => spy.mockRestore());
  return seen;
}

const ok = async () => new Response("{}", { status: 200 });

function untilAborted(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("a cancel whose lookup answers after it was aborted sends nothing to the printer", async () => {
  const dns = holdPrinterDns(["192.168.1.40"]);
  restores.push(dns.restore);
  const seen = requests(ok);
  const bound = new AbortController();
  const cancel = plugin.cancel?.(handle, undefined, bound.signal);
  bound.abort();
  dns.answer();
  await expect(cancel).rejects.toThrow("moonraker cancel abandoned before it was sent");
  expect(seen).toEqual([]);
});

test("aborting a cancel stops the request it has in flight", async () => {
  const stub = stubPrinterDns(["192.168.1.40"]);
  restores.push(stub.restore);
  const signals: AbortSignal[] = [];
  const seen = requests((signal) => {
    signals.push(signal);
    return untilAborted(signal);
  });
  const bound = new AbortController();
  const cancel = plugin.cancel?.(handle, undefined, bound.signal);
  while (signals.length === 0) await Bun.sleep(1);
  bound.abort(new Error("bound expired"));
  await expect(cancel).rejects.toThrow("bound expired");
  expect(seen).toEqual(["http://192.168.1.40:7125/printer/print/cancel"]);
});

test("a cancel with no signal still sends the stop", async () => {
  const stub = stubPrinterDns(["192.168.1.40"]);
  restores.push(stub.restore);
  const seen = requests(ok);
  await plugin.cancel?.(handle);
  expect(seen).toEqual(["http://192.168.1.40:7125/printer/print/cancel"]);
});
