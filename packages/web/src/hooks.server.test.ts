import { describe, expect, test } from "bun:test";
import type { Handle } from "@sveltejs/kit";
import { handle } from "./hooks.server";

const CSP = "default-src 'self'; connect-src 'self'; frame-ancestors 'none'";

async function served(url: string, headers: Record<string, string>) {
  const input = {
    event: { url: new URL(url) },
    resolve: async () => new Response("<p>ok</p>", { headers }),
  } as unknown as Parameters<Handle>[0];
  return (await handle(input)).headers;
}

describe("handle", () => {
  test("adds the request's host and port to connect-src", async () => {
    const headers = await served("https://h.example:8443/", { "content-security-policy": CSP });
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'self'; connect-src 'self' ws://h.example:8443 wss://h.example:8443; frame-ancestors 'none'",
    );
  });

  test("leaves a response without a CSP header alone", async () => {
    const headers = await served("https://h.example:8443/", { "content-type": "text/plain" });
    expect(headers.get("content-security-policy")).toBeNull();
    expect(headers.get("content-type")).toBe("text/plain");
  });

  test("keeps connect-src at 'self' for an IPv6 host", async () => {
    const headers = await served("https://[::1]:8443/", { "content-security-policy": CSP });
    expect(headers.get("content-security-policy")).toBe(CSP);
  });
});
