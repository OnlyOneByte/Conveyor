import { describe, expect, test } from "bun:test";
import { AllowedHostsError, allowedHosts, hostAllowed } from "./allowed-hosts";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
const names = (env: Record<string, string>) => [...allowedHosts(env).names];

describe("allowedHosts", () => {
  test("defaults to the loopback names", () => {
    expect(names({})).toEqual(LOOPBACK);
    expect(names({ CONVEYOR_DOMAIN: "", CONVEYOR_ALLOWED_HOSTS: " " })).toEqual(LOOPBACK);
    expect(allowedHosts({}).suffixes).toEqual([]);
  });

  test("adds CONVEYOR_ALLOWED_HOSTS to the loopback names and the domain, never replacing them", () => {
    expect(
      names({
        CONVEYOR_DOMAIN: "conveyor.example",
        CONVEYOR_ALLOWED_HOSTS: "printer.lan,192.168.1.40 [fd00::4]",
      }),
    ).toEqual([...LOOPBACK, "conveyor.example", "printer.lan", "192.168.1.40", "[fd00::4]"]);
  });

  test.each([
    ["a plain name, in another case", "Conveyor.Example", ["conveyor.example"], []],
    ["a name with a port", "conveyor.example:8443", ["conveyor.example"], []],
    ["several names", "a.example, b.example", ["a.example", "b.example"], []],
    ["an http:// address", "http://conveyor.example", ["conveyor.example"], []],
    [
      "an https:// address with a port and slash",
      "https://conveyor.example:8443/",
      ["conveyor.example"],
      [],
    ],
    ["a name with an underscore", "my_printer.lan", ["my_printer.lan"], []],
    ["a wildcard", "*.example.com", [], ["example.com"]],
    ["an https:// wildcard", "https://*.example.com", [], ["example.com"]],
    ["the any-host :443", ":443", [], []],
    ["the any-host :80", ":80", [], []],
    ["a bare scheme", "https://", [], []],
  ])("reads Caddy's CONVEYOR_DOMAIN as %s (%p)", (_label, domain, extra, suffixes) => {
    const hosts = allowedHosts({ CONVEYOR_DOMAIN: domain });
    expect([...hosts.names]).toEqual([...LOOPBACK, ...extra]);
    expect(hosts.suffixes).toEqual(suffixes);
  });

  test.each([
    ["CONVEYOR_ALLOWED_HOSTS", "a.example/path"],
    ["CONVEYOR_ALLOWED_HOSTS", "user@a.example"],
    ["CONVEYOR_ALLOWED_HOSTS", "*.[::1]"],
    ["CONVEYOR_ALLOWED_HOSTS", "*"],
    ["CONVEYOR_ALLOWED_HOSTS", "a..example"],
    ["CONVEYOR_DOMAIN", "[not-ipv6]"],
  ])("refuses %s=%p, naming the variable and the fix", (variable, value) => {
    const message = `${variable} has entries that aren't host names or IP addresses: ${JSON.stringify(value)}. List names like printer.lan, 192.168.1.40, [fd00::4] or *.example.com, separated by commas, then restart.`;
    expect(() => allowedHosts({ [variable]: value })).toThrow(AllowedHostsError);
    expect(() => allowedHosts({ [variable]: value })).toThrow(message);
  });
});

describe("hostAllowed", () => {
  const hosts = allowedHosts({
    CONVEYOR_DOMAIN: "conveyor.example",
    CONVEYOR_ALLOWED_HOSTS: "*.lan.example",
  });

  test.each([
    ["the domain behind Caddy", "conveyor.example"],
    ["the domain with a port suffix", "conveyor.example:8443"],
    ["the domain in another case, with a trailing dot", "Conveyor.Example."],
    ["the dev server", "localhost:5173"],
    ["the Compose healthcheck", "127.0.0.1:3000"],
    ["IPv6 loopback with a port", "[::1]:3000"],
    ["IPv6 loopback written longhand", "[0:0:0:0:0:0:0:1]"],
    ["one label under a wildcard", "printer.lan.example"],
    ["two labels under a wildcard", "a.b.lan.example:3000"],
  ])("allows %s (%p)", (_label, host) => {
    expect(hostAllowed(hosts, host)).toBe(true);
  });

  test.each([
    ["a rebound name", "evil.example"],
    ["a rebound name with the API's port", "evil.example:3000"],
    ["a subdomain of the domain", "api.conveyor.example"],
    ["a name that ends like the domain", "evilconveyor.example"],
    ["a wildcard's own name, with no label", "lan.example"],
    ["a name that ends like a wildcard", "evillan.example"],
    ["the any-address", "0.0.0.0:3000"],
    ["a LAN address not listed", "192.168.1.40"],
    ["another IPv6 address", "[::2]"],
    ["an empty Host", ""],
    ["userinfo before an allowed name", "evil.example@localhost"],
    ["a scheme in the Host", "http://localhost"],
    ["a bad port", "localhost:abc"],
  ])("refuses %s (%p)", (_label, host) => {
    expect(hostAllowed(hosts, host)).toBe(false);
  });

  test("an any-host domain adds nothing, so only the loopback names are served", () => {
    const any = allowedHosts({ CONVEYOR_DOMAIN: ":443" });
    expect(hostAllowed(any, "localhost")).toBe(true);
    expect(hostAllowed(any, "conveyor.example")).toBe(false);
  });
});
