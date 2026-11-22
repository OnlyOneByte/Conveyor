import { describe, expect, test } from "bun:test";
import { loginLimiter } from "./login-limit.ts";

const limits = { maxFailures: 3, windowMs: 1000, maxClients: 2 };

describe("loginLimiter", () => {
  test("blocks a client after its failures fill the window, until the window ends", () => {
    const limiter = loginLimiter(limits);
    for (const at of [0, 100, 200]) {
      expect(limiter.retryAfterMs("a", at)).toBe(0);
      limiter.failed("a", at);
    }
    expect(limiter.retryAfterMs("a", 300)).toBe(700);
    expect(limiter.retryAfterMs("b", 300)).toBe(0);
    expect(limiter.retryAfterMs("a", 1500)).toBe(0);
    limiter.failed("a", 1500);
    expect(limiter.retryAfterMs("a", 1500)).toBe(0);
  });

  test("forgets a client's failures once it logs in", () => {
    const limiter = loginLimiter(limits);
    limiter.failed("a", 0);
    limiter.failed("a", 0);
    limiter.succeeded("a");
    limiter.failed("a", 0);
    limiter.failed("a", 0);
    expect(limiter.retryAfterMs("a", 0)).toBe(0);
  });

  test("keeps at most maxClients entries, dropping the oldest", () => {
    const limiter = loginLimiter(limits);
    for (let i = 0; i < 3; i++) limiter.failed("a", 0);
    limiter.failed("b", 0);
    limiter.failed("c", 0);
    expect(limiter.retryAfterMs("a", 0)).toBe(0);
  });
});
