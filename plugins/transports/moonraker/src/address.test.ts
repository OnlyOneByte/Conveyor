import { afterAll, describe, expect, spyOn, test } from "bun:test";
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

function fakeFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  };
  fetchSpy.mockImplementation(Object.assign(impl, { preconnect }));
  return calls;
}

describe("moonraker printer addresses", () => {
  test.each([
    ["fe80::1", "http://[fe80::1]:80/printer/print/cancel"],
    ["[fe80::1]:7125", "http://[fe80::1]:7125/printer/print/cancel"],
    ["http://[fe80::1]:7125/", "http://[fe80::1]:7125/printer/print/cancel"],
    ["printer.local/moonraker", "http://printer.local:80/moonraker/printer/print/cancel"],
    ["10.0.0.9:7125/moonraker/", "http://10.0.0.9:7125/moonraker/printer/print/cancel"],
    ["[fe80::1]:7125/moonraker", "http://[fe80::1]:7125/moonraker/printer/print/cancel"],
    ["//printer.local/moonraker", "http://printer.local:80/moonraker/printer/print/cancel"],
    ["HTTP://printer.local:7125/", "HTTP://printer.local:7125/printer/print/cancel"],
    ["printer.local\n", "http://printer.local:80/printer/print/cancel"],
    ["10.0.0.5:7125\r\n", "http://10.0.0.5:7125/printer/print/cancel"],
  ])("%p is reached at %p", async (address, url) => {
    const calls = fakeFetch();
    await moonraker.cancel?.({ ...handle, address });
    expect(calls.map((c) => c.url)).toEqual([url]);
  });

  test.each([
    ["admin:pw@printer.local", "http://printer.local:80/printer/print/cancel"],
    ["admin:pw@printer.local/moonraker", "http://printer.local:80/moonraker/printer/print/cancel"],
    [
      "//admin:pw@printer.local/moonraker",
      "http://printer.local:80/moonraker/printer/print/cancel",
    ],
  ])("%p drops its credentials and is reached at %p", async (address, url) => {
    const calls = fakeFetch();
    await moonraker.cancel?.({ ...handle, address });
    expect(calls.map((c) => c.url)).toEqual([url]);
    expect(new Headers(calls[0]?.init?.headers).has("authorization")).toBe(false);
  });

  test.each([
    ["admin:pa/ss@printer.local", '"***@printer.local": the port must be a number'],
    [
      "admin:s3\ncret@printer.local",
      '"***@printer.local": the address contains a control character',
    ],
  ])("%p fails without quoting any part of the password", async (address, reason) => {
    const calls = fakeFetch();
    const stop = moonraker.cancel?.({ ...handle, address }) ?? Promise.resolve();
    await expect(stop).rejects.toThrow(`moonraker printer address ${reason}`);
    await expect(stop).rejects.not.toThrow(/admin|pa\/ss|s3|cret/);
    expect(calls).toHaveLength(0);
  });

  test("an ambiguous address fails with the parser's reason and sends nothing", async () => {
    const calls = fakeFetch();
    const stop = moonraker.cancel?.({ ...handle, address: "fe80::1::2" }) ?? Promise.resolve();
    await expect(stop).rejects.toThrow('moonraker printer address "fe80::1::2": not a valid IPv6');
    expect(calls).toHaveLength(0);
  });
});
