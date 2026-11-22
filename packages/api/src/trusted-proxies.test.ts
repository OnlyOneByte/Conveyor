import { describe, expect, test } from "bun:test";
import { clientKey, parseTrustedProxies } from "./trusted-proxies.ts";

describe("parseTrustedProxies", () => {
  test("trusts nothing when unset or blank", () => {
    expect(parseTrustedProxies(undefined)).toBe(false);
    expect(parseTrustedProxies("  ")).toBe(false);
  });

  test("accepts IPv4 and IPv6 addresses and CIDRs", () => {
    expect(parseTrustedProxies("172.31.250.2, 10.0.0.0/8,::1,fd00::/8")).toEqual([
      "172.31.250.2",
      "10.0.0.0/8",
      "::1",
      "fd00::/8",
    ]);
  });

  test.each(["caddy", "10.0.0.0/33", "::1/129", "10.0.0.1/8/1", "10.0.0.1/", "1.2.3.4,", "/8"])(
    "refuses %p",
    (raw) => {
      expect(() => parseTrustedProxies(raw)).toThrow("CONVEYOR_TRUSTED_PROXIES must be");
    },
  );
});

describe("clientKey", () => {
  test("keeps an IPv4 address, and unwraps an IPv4-mapped one", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("keys IPv6 by its /64, however it is written", () => {
    expect(clientKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:0DB8:0001:0002:ffff:0:0:abcd")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("::1")).toBe("0:0:0:0::/64");
    expect(clientKey("2001:db8:1:3::1")).not.toBe(clientKey("2001:db8:1:2::1"));
  });
});
