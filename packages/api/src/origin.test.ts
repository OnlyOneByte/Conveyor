import { describe, expect, test } from "bun:test";
import { isCrossOriginWrite, type WriteRequest } from "./origin";

const post = (over: Partial<WriteRequest>): WriteRequest => ({
  method: "POST",
  host: "conveyor.example",
  origin: undefined,
  fetchSite: undefined,
  ...over,
});

describe("isCrossOriginWrite", () => {
  test.each([
    ["the public host behind Caddy", "https://conveyor.example", "conveyor.example"],
    ["a non-default port behind Caddy", "https://conveyor.example:8443", "conveyor.example:8443"],
    ["the default port written out in Host", "https://conveyor.example", "conveyor.example:443"],
    [
      "the Vite dev server, which keeps the browser's Host",
      "http://localhost:5173",
      "localhost:5173",
    ],
    ["a host in another case", "https://Conveyor.Example", "conveyor.EXAMPLE"],
    ["Caddy's localhost default", "https://localhost", "localhost"],
  ])("lets through a write from its own origin: %s", (_label, origin, host) => {
    expect(isCrossOriginWrite(post({ origin, host }))).toBe(false);
  });

  test.each([
    ["another site", "https://evil.example"],
    ["a sibling subdomain", "https://other.conveyor.example"],
    ["the same host on another port", "https://conveyor.example:8080"],
    ["an opaque origin", "null"],
    ["an unparseable origin", "not a url"],
    ["a file page", "file://"],
  ])("refuses a write from %s", (_label, origin) => {
    expect(isCrossOriginWrite(post({ origin }))).toBe(true);
  });

  test.each(["PUT", "PATCH", "DELETE", "get"])("checks %s like POST", (method) => {
    expect(isCrossOriginWrite(post({ method, origin: "https://evil.example" }))).toBe(true);
  });

  test.each(["GET", "HEAD", "OPTIONS"])("never refuses %s", (method) => {
    expect(isCrossOriginWrite(post({ method, origin: "https://evil.example" }))).toBe(false);
  });

  test("with no Origin, a client that isn't a browser is let through", () => {
    expect(isCrossOriginWrite(post({}))).toBe(false);
  });

  test.each([
    ["same-origin", false],
    ["none", false],
    ["same-site", true],
    ["cross-site", true],
  ])("with no Origin, Sec-Fetch-Site %p decides: refused %p", (fetchSite, refused) => {
    expect(isCrossOriginWrite(post({ fetchSite }))).toBe(refused);
  });

  test("a cross-site Sec-Fetch-Site refuses even a matching Origin", () => {
    const own = { origin: "https://conveyor.example", fetchSite: "cross-site" };
    expect(isCrossOriginWrite(post(own))).toBe(true);
  });

  test("a same-origin Sec-Fetch-Site doesn't excuse a foreign Origin", () => {
    const foreign = { origin: "https://evil.example", fetchSite: "same-origin" };
    expect(isCrossOriginWrite(post(foreign))).toBe(true);
  });
});
