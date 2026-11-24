import { describe, expect, test } from "bun:test";
import { formatHostPort, parseHostPort } from "./address.js";

describe("parseHostPort", () => {
  test.each([
    ["printer.local.", "printer.local.", 3030],
    ["printer.local.:7125", "printer.local.", 7125],
    ["http://printer.local.:7125/", "printer.local.", 7125],
    ["voron_2.local", "voron_2.local", 3030],
    ["_printer:7125", "_printer", 7125],
    ["http://admin:s3cret@printer.local:7125/", "printer.local", 7125],
    ["printer.local\n", "printer.local", 3030],
    ["10.0.0.5:7125\r\n", "10.0.0.5", 7125],
    ["\tprinter.local", "printer.local", 3030],
  ])("accepts %p as %p port %p", (address, host, port) => {
    expect(parseHostPort(address, 3030)).toEqual({ kind: "parsed", host, port });
  });

  test("whitespace around the full address is ignored, as it is around the host", () => {
    expect(parseHostPort("printer.local", 80, "\tprinter.local/moonraker\r\n")).toEqual({
      kind: "parsed",
      host: "printer.local",
      port: 80,
    });
  });

  test.each([
    ["http://printer:0/", '"http://printer:0/": the port must be a number from 1 to 65535'],
    ["ws://[fe80::1]:0", '"ws://[fe80::1]:0": the port must be a number from 1 to 65535'],
    ["printer..local", '"printer..local": not an IPv4 address, IPv6 address or hostname'],
    ["printer.local..", '"printer.local..": not an IPv4 address, IPv6 address or hostname'],
    ["http://admin:s3cret@[bad/", '"http://***@[bad/": not a valid URL'],
    ["http://admin:pa/ss@[bad/", '"http://***@[bad/": not a valid URL'],
    [
      "http://admin:s3cret@printer:0/",
      '"http://***@printer:0/": the port must be a number from 1 to 65535',
    ],
    ["admin:s3cret@printer", '"***@printer": the port must be a number from 1 to 65535'],
    ["admin@printer.local", '"***@printer.local": not an IPv4 address, IPv6 address or hostname'],
    ["//admin:s3cret@printer", '"//***@printer": not an IPv4 address, IPv6 address or hostname'],
    [
      "admin:p@ss@printer:7125",
      '"***@printer:7125": not a valid IPv6 address; to give a port, write it as [fe80::1]:3030',
    ],
    [
      "admin:s3\ncret@printer",
      '"***@printer": the address contains a control character or line break',
    ],
    [
      "printer.local\u0007",
      '"printer.local\\u0007": the address contains a control character or line break',
    ],
  ])("rejects %p", (address, reason) => {
    expect(parseHostPort(address, 3030)).toEqual({ kind: "invalid", reason });
  });

  test.each(["fe80::1%eth0", "[fe80::1%eth0]", "[fe80::1%eth0]:7125"])(
    "rejects the zone ID in %p, which no printer URL can hold",
    (address) => {
      expect(parseHostPort(address, 3030)).toEqual({
        kind: "invalid",
        reason: `${JSON.stringify(address)}: IPv6 zone IDs such as %eth0 can't be used in a printer URL; give the address without the zone`,
      });
    },
  );

  test("a reason quotes the full address it is given, redacted, instead of the host part", () => {
    expect(parseHostPort("admin:pa", 80, "admin:pa/ss@printer.local")).toEqual({
      kind: "invalid",
      reason: '"***@printer.local": the port must be a number from 1 to 65535',
    });
  });

  test("a control character anywhere in the full address rejects the host part", () => {
    expect(parseHostPort("printer.local", 80, "printer.local/a\nb")).toEqual({
      kind: "invalid",
      reason: '"printer.local/a\\nb": the address contains a control character or line break',
    });
  });

  test("an https URL without a port uses 443, anything else the given default", () => {
    expect(parseHostPort("https://printer.local", 3030)).toEqual({
      kind: "parsed",
      host: "printer.local",
      port: 443,
    });
    expect(parseHostPort("fe80::1", 3030)).toEqual({ kind: "parsed", host: "fe80::1", port: 3030 });
  });
});

describe("formatHostPort", () => {
  test.each([
    ["fe80::1", 3030, "[fe80::1]:3030"],
    ["::1", 80, "[::1]:80"],
    ["10.0.0.5", 7125, "10.0.0.5:7125"],
    ["printer.local.", 80, "printer.local.:80"],
  ])("%p and %p give %p", (host, port, expected) => {
    expect(formatHostPort(host, port)).toBe(expected);
  });
});
