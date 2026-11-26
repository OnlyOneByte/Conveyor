import { describe, expect, test } from "bun:test";
import { signedIn } from "./api.js";
import { AUTH_TIMEOUT_MS, checkAuth } from "./auth-gate.js";

const answering = (respond: () => Promise<Response>) =>
  Object.assign(respond, { preconnect: globalThis.fetch.preconnect });

describe("checkAuth", () => {
  test("a gateway error is a down gate, never signed in", async () => {
    const gate = await checkAuth(answering(async () => Response.json({}, { status: 503 })));
    expect(gate).toEqual({
      auth: null,
      down: { hint: "Check that it's running, then try again.", detail: "GET /auth/status 503" },
    });
    expect(signedIn(gate.auth)).toBe(false);
  });

  test("a network failure asks to check the connection", async () => {
    const gate = await checkAuth(answering(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(gate.down).toEqual({
      hint: "Check your connection, then try again.",
      detail: "Failed to fetch",
    });
    expect(signedIn(gate.auth)).toBe(false);
  });

  test("a server error says Conveyor hit a problem", async () => {
    const gate = await checkAuth(answering(async () => Response.json({}, { status: 500 })));
    expect(gate.down?.hint).toBe(
      "Conveyor hit a problem checking your sign-in. Try again in a moment.",
    );
    expect(gate.down?.detail).toBe("GET /auth/status 500");
    expect(signedIn(gate.auth)).toBe(false);
  });

  test.each([
    ["an empty object", "{}"],
    ["a bare true", "true"],
    ["a null", "null"],
    ["half a status", '{"authEnabled":false}'],
    ["another route's answer", '{"ok":true}'],
    ["a string flag", '{"authEnabled":"false","authenticated":false}'],
    ["an extra key", '{"authEnabled":false,"authenticated":false,"admin":true}'],
    ["a body that isn't JSON", "<html>"],
  ])("a 200 with %s is a down gate, never the shell", async (_, body) => {
    const gate = await checkAuth(answering(async () => new Response(body, { status: 200 })));
    expect(gate).toEqual({
      auth: null,
      down: {
        hint: "Conveyor hit a problem checking your sign-in. Try again in a moment.",
        detail: "GET /auth/status answered in an unexpected shape",
      },
    });
    expect(signedIn(gate.auth)).toBe(false);
  });

  test("a check that never answers times out onto the down gate", async () => {
    const hang = (_: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );
    const gate = await checkAuth(
      Object.assign(hang, { preconnect: globalThis.fetch.preconnect }),
      20,
    );
    expect(gate).toEqual({
      auth: null,
      down: {
        hint: "Check that it's running, then try again.",
        detail: "GET /auth/status timed out after 20 ms",
      },
    });
  });

  test("the sign-in check waits 8 s before giving up", () => {
    expect(AUTH_TIMEOUT_MS).toBe(8000);
  });

  test("an answer passes through with no down state", async () => {
    const auth = { authEnabled: true, authenticated: false };
    const gate = await checkAuth(answering(async () => Response.json(auth)));
    expect(gate).toEqual({ auth, down: null });
    expect(signedIn(gate.auth)).toBe(false);
    expect(signedIn({ authEnabled: false, authenticated: false })).toBe(true);
  });
});
