import { describe, expect, test } from "bun:test";
import { parseAddress, probePrinter } from "./printer-probe.js";

describe("parseAddress accepts", () => {
  test.each([
    ["[fe80::1]:3030", "moonraker", "fe80::1", 3030],
    ["[::1]:7125", "moonraker", "::1", 7125],
    ["[fe80::1]", "elegoo", "fe80::1", 3030],
    ["fe80::1", "elegoo", "fe80::1", 3030],
    ["::1", "moonraker", "::1", 80],
    ["fe80::1%eth0", "elegoo", "fe80::1%eth0", 3030],
    ["2001:db8::8a2e:370:7334", "moonraker", "2001:db8::8a2e:370:7334", 80],
    ["10.0.0.5", "elegoo", "10.0.0.5", 3030],
    ["10.0.0.5:7125", "elegoo", "10.0.0.5", 7125],
    ["  10.0.0.5  ", "elegoo", "10.0.0.5", 3030],
    ["printer.local", "moonraker", "printer.local", 80],
    ["printer.local:7125", "moonraker", "printer.local", 7125],
    ["voron-2", "custom", "voron-2", 80],
    ["http://printer.local:7125/api", "moonraker", "printer.local", 7125],
    ["https://printer.local", "moonraker", "printer.local", 443],
    ["ws://printer.local", "elegoo", "printer.local", 3030],
    ["http://[fe80::1]:7125/", "moonraker", "fe80::1", 7125],
  ])("%p for %p as %p port %p", (address, transport, host, port) => {
    expect(parseAddress(address, transport)).toEqual({ kind: "parsed", host, port });
  });
});

describe("parseAddress rejects", () => {
  test.each([
    ["", "the address is empty"],
    ["   ", "the address is empty"],
    ["fe80:", "the port must be a number from 1 to 65535"],
    ["fe80::1::2", "not a valid IPv6 address; to give a port, write it as [fe80::1]:3030"],
    ["10.0.0.5:3030:1", "not a valid IPv6 address; to give a port, write it as [fe80::1]:3030"],
    ["[10.0.0.5]:3030", "brackets must hold an IPv6 address, as in [fe80::1]:3030"],
    ["[fe80::1", "brackets must hold an IPv6 address, as in [fe80::1]:3030"],
    ["[fe80::1]3030", "brackets must hold an IPv6 address, as in [fe80::1]:3030"],
    ["[fe80::1]:", "the port must be a number from 1 to 65535"],
    ["[fe80::1]:70000", "the port must be a number from 1 to 65535"],
    ["10.0.0.5:0", "the port must be a number from 1 to 65535"],
    ["printer.local:http", "the port must be a number from 1 to 65535"],
    ["10.0.0.256", "not a valid IPv4 address"],
    ["printer local", "not an IPv4 address, IPv6 address or hostname"],
    ["http://", 'not a valid URL ("http://" cannot be parsed as a URL.)'],
  ])("%p with %p", (address, why) => {
    expect(parseAddress(address, "elegoo")).toEqual({
      kind: "invalid",
      reason: `${JSON.stringify(address.trim() || address)}: ${why}`,
    });
  });
});

describe("probePrinter", () => {
  test("an ambiguous address is unreachable and says why, without opening a socket", async () => {
    expect(await probePrinter("fe80::1::2", "elegoo")).toEqual({
      reachable: false,
      host: "fe80::1::2",
      port: 0,
      reason:
        'unparseable address "fe80::1::2": not a valid IPv6 address; to give a port, write it as [fe80::1]:3030',
    });
  });
});
