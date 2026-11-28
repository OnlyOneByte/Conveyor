import { describe, expect, test } from "bun:test";
import { AllowedHostsError, allowedHosts, hostAllowed } from "./allowed-hosts";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

describe("allowedHosts", () => {
  test("defaults to the loopback names", () => {
    expect([...allowedHosts({})]).toEqual(LOOPBACK);
    expect([...allowedHosts({ CONVEYOR_DOMAIN: "", CONVEYOR_ALLOWED_HOSTS: " " })]).toEqual(
      LOOPBACK,
    );
  });

  test("adds Caddy's CONVEYOR_DOMAIN, one name or several, dropping a scheme or port", () => {
    expect([...allowedHosts({ CONVEYOR_DOMAIN: "Conveyor.Example" })]).toEqual([
      ...LOOPBACK,
      "conveyor.example",
    ]);
    const several = allowedHosts({ CONVEYOR_DOMAIN: "https://a.example:8443, b.example" });
    expect([...several].slice(3)).toEqual(["a.example", "b.example"]);
  });

  test("adds CONVEYOR_ALLOWED_HOSTS to the loopback names and the domain, never replacing them", () => {
    const hosts = allowedHosts({
      CONVEYOR_DOMAIN: "conveyor.example",
      CONVEYOR_ALLOWED_HOSTS: "printer.lan,192.168.1.40 [fd00::4]",
    });
    expect([...hosts]).toEqual([
      ...LOOPBACK,
      "conveyor.example",
      "printer.lan",
      "192.168.1.40",
      "[fd00::4]",
    ]);
  });

  test.each([
    ["CONVEYOR_ALLOWED_HOSTS", "*.example"],
    ["CONVEYOR_ALLOWED_HOSTS", "a.example/path"],
    ["CONVEYOR_ALLOWED_HOSTS", "user@a.example"],
    ["CONVEYOR_ALLOWED_HOSTS", "a_b.example"],
    ["CONVEYOR_DOMAIN", ":443"],
    ["CONVEYOR_DOMAIN", "[not-ipv6]"],
  ])("refuses %s=%p, naming the variable", (variable, value) => {
    expect(() => allowedHosts({ [variable]: value })).toThrow(AllowedHostsError);
    expect(() => allowedHosts({ [variable]: value })).toThrow(
      `${variable} must be a comma-separated list of host names or IP addresses`,
    );
  });
});

describe("hostAllowed", () => {
  const hosts = allowedHosts({ CONVEYOR_DOMAIN: "conveyor.example" });

  test.each([
    ["the domain behind Caddy", "conveyor.example"],
    ["the domain with a port suffix", "conveyor.example:8443"],
    ["the domain in another case, with a trailing dot", "Conveyor.Example."],
    ["the dev server", "localhost:5173"],
    ["the Compose healthcheck", "127.0.0.1:3000"],
    ["IPv6 loopback with a port", "[::1]:3000"],
    ["IPv6 loopback written longhand", "[0:0:0:0:0:0:0:1]"],
  ])("allows %s (%p)", (_label, host) => {
    expect(hostAllowed(hosts, host)).toBe(true);
  });

  test.each([
    ["a rebound name", "evil.example"],
    ["a rebound name with the API's port", "evil.example:3000"],
    ["a subdomain of the domain", "api.conveyor.example"],
    ["a name that ends like the domain", "evilconveyor.example"],
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
});
