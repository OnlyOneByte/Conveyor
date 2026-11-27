import { afterEach, expect, spyOn, test } from "bun:test";
import type { PrintHandle } from "@conveyor/shared";
import { stubPrinterDns } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker as plugin } from "./index.ts";

const { preconnect } = globalThis.fetch;
const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

function dnsAnswers(...answers: string[][]) {
  const stub = stubPrinterDns(...answers);
  restores.push(stub.restore);
  return stub.asked;
}

function requests() {
  const seen: { url: string; host: string | null }[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(input), host: new Headers(init?.headers).get("host") });
        return new Response("{}", { status: 200 });
      },
      { preconnect },
    ),
  );
  restores.push(() => spy.mockRestore());
  return seen;
}

const handle: PrintHandle = {
  transportId: "moonraker",
  printerId: "p1",
  ref: "a.gcode",
  address: "printer.example:7125",
};

test("a cancel connects to the IP the guard checked, so a name that rebinds to metadata is never reached", async () => {
  const asked = dnsAnswers(["192.168.1.40"], ["169.254.169.254"]);
  const seen = requests();
  await plugin.cancel?.(handle);
  expect(asked).toEqual(["printer.example"]);
  expect(seen).toEqual([
    { url: "http://192.168.1.40:7125/printer/print/cancel", host: "printer.example:7125" },
  ]);
});

test("each later request checks the name again and refuses it once it points at metadata", async () => {
  dnsAnswers(["192.168.1.40"], ["169.254.169.254"]);
  const seen = requests();
  await plugin.cancel?.(handle);
  await expect(plugin.cancel?.(handle)).rejects.toThrow(
    "Conveyor won't connect to printer.example",
  );
  expect(seen).toHaveLength(1);
});

test.each([
  "x://printer.example:7125",
  "ftp://printer.example",
  "ws://printer.example",
  "wss://printer.example",
])("a %s address is refused with the scheme message, before any request", async (address) => {
  dnsAnswers(["192.168.1.40"]);
  const seen = requests();
  const err = await plugin.cancel?.({ ...handle, address }).catch((e: unknown) => e);
  expect(String(err)).toMatch(/Conveyor connects to (Moonraker )?printers only over http/);
  expect(String(err)).not.toContain("the port must be a number");
  expect(seen).toEqual([]);
});
