import { describe, expect, test } from "bun:test";
import { withSocketSources } from "./csp";

const csp = "default-src 'self'; connect-src 'self'; worker-src 'self'";

describe("withSocketSources", () => {
  test("adds the request host's ws and wss origins to connect-src only", () => {
    expect(withSocketSources(csp, "conveyor.example:8443")).toBe(
      "default-src 'self'; connect-src 'self' ws://conveyor.example:8443 wss://conveyor.example:8443; worker-src 'self'",
    );
  });

  test("works when connect-src is the first directive", () => {
    expect(withSocketSources("connect-src 'self'", "localhost")).toBe(
      "connect-src 'self' ws://localhost wss://localhost",
    );
  });

  test.each(["evil;script-src *", "a b", "[::1]:3000", ""])(
    "leaves the policy unchanged for the host %p",
    (host) => {
      expect(withSocketSources(csp, host)).toBe(csp);
    },
  );
});
