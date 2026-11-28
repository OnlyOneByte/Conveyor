import { describe, expect, test } from "bun:test";
import { AllowedHostsError, allowedHosts } from "./allowed-hosts";
import { isPublicSuffix } from "./public-suffix";

describe("isPublicSuffix", () => {
  test.each([
    "com",
    "uk",
    "localhost",
    "co.uk",
    "com.au",
    "org.nz",
    "ne.jp",
    "duckdns.org",
    "github.io",
    "ts.net",
    "nip.io",
    "ngrok.app",
    "ngrok.dev",
    "eu.org",
    "github.dev",
    "k12.ca.us",
    "s3.amazonaws.com",
    "mooo.com",
  ])("%p is a public or shared zone", (suffix) => {
    expect(isPublicSuffix(suffix)).toBe(true);
  });

  test.each([
    "example.com",
    "home.example.com",
    "myname.duckdns.org",
    "printer.co.uk",
    "lan.example",
    "co.example",
    "com.example",
    "example.de",
    "home.io",
    "lan",
    "local",
    "internal",
    "home.arpa",
    "me.ngrok.app",
  ])("%p belongs to someone", (suffix) => {
    expect(isPublicSuffix(suffix)).toBe(false);
  });
});

describe("a wildcard in the Host allowlist", () => {
  test.each([
    ["CONVEYOR_ALLOWED_HOSTS", "*.com"],
    ["CONVEYOR_ALLOWED_HOSTS", "*.co.uk"],
    ["CONVEYOR_ALLOWED_HOSTS", "printer.lan, *.duckdns.org"],
    ["CONVEYOR_DOMAIN", "https://*.github.io"],
    ["CONVEYOR_DOMAIN", "*.localhost"],
    ["CONVEYOR_ALLOWED_HOSTS", "*.ngrok.app"],
    ["CONVEYOR_ALLOWED_HOSTS", "*.eu.org"],
  ])("over a public zone stops startup, saying why (%s=%p)", (variable, value) => {
    const wildcard = value.split(/[\s,]+/).find((v) => v.includes("*")) ?? "";
    const message = `${variable} has wildcards over a public or shared zone: ${JSON.stringify(wildcard)}. Anyone can get a name in such a zone and point it at this API, which would get past the Host check. Use a zone that belongs to you alone, such as *.home.example.com, or list the names, then restart.`;
    expect(() => allowedHosts({ [variable]: value })).toThrow(AllowedHostsError);
    expect(() => allowedHosts({ [variable]: value })).toThrow(message);
  });

  test.each([
    "*.example.com",
    "*.myname.duckdns.org",
    "*.home.co.uk",
    "*.lan",
    "*.local",
    "*.internal",
    "*.home.arpa",
  ])("over the operator's own zone is allowed (%p)", (value) => {
    expect(allowedHosts({ CONVEYOR_ALLOWED_HOSTS: value }).suffixes).toEqual([value.slice(2)]);
  });

  test("a plain name in a public zone is still allowed", () => {
    expect([...allowedHosts({ CONVEYOR_ALLOWED_HOSTS: "myname.duckdns.org" }).names]).toContain(
      "myname.duckdns.org",
    );
  });
});
