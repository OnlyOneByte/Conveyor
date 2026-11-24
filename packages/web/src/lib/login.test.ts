import { afterEach, describe, expect, test } from "bun:test";
import { LoginError, login } from "./login.js";

const realFetch = globalThis.fetch;
const called: string[] = [];
const answer = (response: Response) => {
  const stub = async (url: string | URL | Request) => {
    called.push(String(url));
    return response;
  };
  globalThis.fetch = Object.assign(stub, { preconnect: realFetch.preconnect });
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("login", () => {
  test("throws a LoginError with the status and the server's message", async () => {
    answer(Response.json({ error: "invalid password" }, { status: 401 }));
    const error = await login("nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoginError);
    expect(error).toMatchObject({ status: 401, message: "invalid password" });
  });

  test("falls back to the status when the body has no error text", async () => {
    answer(new Response("<html>", { status: 429 }));
    const error = await login("nope").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429, message: "login failed (429)" });
  });

  test("resolves when the password is accepted", async () => {
    answer(new Response(null, { status: 204 }));
    expect(await login("right")).toBeUndefined();
    expect(called.at(-1)).toBe("/api/auth/login");
  });
});
