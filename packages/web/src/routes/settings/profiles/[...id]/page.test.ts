import { describe, expect, test } from "bun:test";
import { shown } from "#lib/http-error.js";
import { NOT_LOADED } from "#lib/said.js";
import { load } from "./+page";

const answering = (status: number, body: unknown): typeof fetch =>
  Object.assign(async () => Response.json(body, { status }), { preconnect: () => {} });

const run = (fetchFn: typeof fetch): Promise<unknown> =>
  Reflect.apply(load, undefined, [
    {
      params: { id: "orca/klipper-pla-0.2" },
      fetch: fetchFn,
      parent: async () => ({ auth: { authEnabled: false, authenticated: false } }),
    },
  ]);

describe("a profile that fails to load", () => {
  test("leads with a plain sentence and keeps the server's own reason for Details", async () => {
    const reason = "databaseislocked".repeat(40);
    expect(await run(answering(500, { error: reason }))).toMatchObject({
      failed: false,
      problem: NOT_LOADED,
      detail: shown(reason),
    });
  });

  test("a bare status keeps the status line as the detail", async () => {
    expect(await run(answering(500, {}))).toMatchObject({
      problem: NOT_LOADED,
      detail: "GET /api/catalog/profiles 500",
    });
  });

  test("an unreachable Conveyor is the can't-reach state, with no detail", async () => {
    const offline = Object.assign(
      async () => {
        throw new TypeError("fetch failed");
      },
      { preconnect: () => {} },
    );
    expect(await run(offline)).toMatchObject({ failed: true, problem: "", detail: null });
  });
});
